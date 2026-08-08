#!/usr/bin/env python3
"""Integration tests for the ThreadLink server, driven over raw TCP sockets
so we can precisely control framing (fragmentation, coalescing, oversized
frames) in ways the terminal client can't easily exercise.

Speaks the wire protocol directly: [4-byte big-endian length][payload].
See docs/PROTOCOL.md for the full contract this exercises.

Usage: python3 tests/run_tests.py [path-to-server-binary]
Exits 0 if all tests pass, 1 otherwise.
"""
import os
import socket
import struct
import subprocess
import sys
import tempfile
import time
import traceback

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER_BIN = sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO_ROOT, "server")
TEST_PORT = 8099
TEST_MAX_MESSAGE_SIZE = 4096
# ThreadSanitizer instrumentation adds substantial runtime overhead
# (commonly 5-15x) on top of whatever load is already on the machine,
# so a socket timeout comfortable for plain debug/release builds can
# legitimately be too tight for a `make tsan` binary under load even
# though nothing is actually wrong -- the server still delivers the
# frame, just slower. THREADLINK_TEST_TIMEOUT lets a slower build/CI
# lane widen the margin without changing the default for normal runs.
CONNECT_TIMEOUT = float(os.environ.get("THREADLINK_TEST_TIMEOUT", "5.0"))

PASS = []
FAIL = []


def report(name, ok, detail=""):
    if ok:
        PASS.append(name)
        print(f"  PASS  {name}")
    else:
        FAIL.append(name)
        print(f"  FAIL  {name}  {detail}")


# ---------------------------------------------------------------------------
# Wire protocol helpers (mirrors include/Protocol.h)
# ---------------------------------------------------------------------------

def encode_frame(payload: bytes) -> bytes:
    return struct.pack(">I", len(payload)) + payload


def recv_exact(sock: socket.socket, n: int) -> bytes:
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError("peer closed while reading")
        buf += chunk
    return buf


def recv_frame(sock: socket.socket) -> bytes:
    header = recv_exact(sock, 4)
    (length,) = struct.unpack(">I", header)
    if length == 0:
        return b""
    return recv_exact(sock, length)


def send_frame(sock: socket.socket, payload: bytes):
    sock.sendall(encode_frame(payload))


def send_frame_fragmented(sock: socket.socket, payload: bytes, delay=0.01):
    """Sends one frame one byte at a time, to genuinely exercise partial
    send()/recv() and TCP fragmentation handling rather than relying on
    coincidental kernel buffering."""
    data = encode_frame(payload)
    for b in data:
        sock.sendall(bytes([b]))
        time.sleep(delay)


def connect() -> socket.socket:
    s = socket.create_connection(("127.0.0.1", TEST_PORT), timeout=CONNECT_TIMEOUT)
    s.settimeout(CONNECT_TIMEOUT)
    return s


def read_type(payload: bytes) -> str:
    return payload.decode(errors="replace").split(" ", 1)[0]


def recv_matching(sock: socket.socket, prefix: bytes, attempts: int = 10) -> bytes:
    """Reads frames until one starts with `prefix`, skipping others. Multiple
    independent client sockets in these tests share one live server, so an
    unrelated client's SYS join/leave (or a settle probe's own churn) can
    legitimately be interleaved with the exact exchange a test cares about;
    tests should key off message content/type rather than raw ordering."""
    for _ in range(attempts):
        frame = recv_frame(sock)
        if frame.startswith(prefix):
            return frame
    raise AssertionError(f"no frame with prefix {prefix!r} within {attempts} attempts")


# ---------------------------------------------------------------------------
# Server process management
# ---------------------------------------------------------------------------

class ServerProcess:
    def __init__(self):
        self.dir = tempfile.mkdtemp(prefix="threadlink_test_")
        conf_path = os.path.join(self.dir, "server.conf")
        with open(conf_path, "w") as f:
            f.write(
                f"PORT={TEST_PORT}\n"
                f"MAX_CLIENTS=10\n"
                f"MAX_MESSAGE_SIZE={TEST_MAX_MESSAGE_SIZE}\n"
                f"LOG_LEVEL=DEBUG\n"
            )
        self.log_path = os.path.join(self.dir, "server.log")
        self.log_file = open(self.log_path, "w")
        self.proc = subprocess.Popen(
            [SERVER_BIN],
            cwd=self.dir,
            stdin=subprocess.PIPE,
            stdout=self.log_file,
            stderr=subprocess.STDOUT,
        )
        self._wait_for_port()

    def _wait_for_port(self, timeout=5.0):
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                s = socket.create_connection(("127.0.0.1", TEST_PORT), timeout=0.2)
                s.close()
                return
            except OSError:
                time.sleep(0.05)
        raise RuntimeError("server did not start listening in time")

    def shutdown_via_stdin(self, timeout=5.0):
        self.proc.stdin.write(b"SHUTDOWN\n")
        self.proc.stdin.flush()
        return self.proc.wait(timeout=timeout)

    def kill(self):
        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait(timeout=3)
        self.log_file.close()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_basic_connect_and_welcome():
    s = connect()
    try:
        payload = recv_frame(s)
        report("basic_connect_and_welcome", read_type(payload) == "WELCOME",
               f"got {payload!r}")
    finally:
        s.close()


def test_nick_change_and_broadcast():
    a = connect()
    b = connect()
    try:
        recv_frame(a)  # WELCOME a
        recv_frame(b)  # WELCOME b
        # No manual drain of the "b joined" SYS notice here: recv_matching()
        # below skips past it (and any other interleaved chatter) on its own.

        send_frame(a, b"/nick alice")
        # a sees NICK broadcast (sent to everyone including self)
        msg = recv_matching(a, b"NICK ")
        ok_a = msg.endswith(b" alice")
        msg_b = recv_matching(b, b"NICK ")
        ok_b = msg_b.endswith(b" alice")

        send_frame(a, b"hello everyone")
        broadcast = recv_matching(b, b"MSG alice ")
        ok_broadcast = broadcast == b"MSG alice hello everyone"

        report("nick_change_and_broadcast", ok_a and ok_b and ok_broadcast,
               f"nick_a={msg!r} nick_b={msg_b!r} broadcast={broadcast!r}")
    finally:
        a.close()
        b.close()


def test_duplicate_nickname_rejected():
    a = connect()
    b = connect()
    try:
        recv_frame(a)  # WELCOME
        recv_frame(b)  # WELCOME

        send_frame(a, b"/nick bob")
        recv_matching(a, b"NICK ")
        recv_matching(b, b"NICK ")

        send_frame(b, b"/nick bob")
        resp = recv_matching(b, b"ERR NICK_TAKEN")
        report("duplicate_nickname_rejected", resp.startswith(b"ERR NICK_TAKEN"),
               f"got {resp!r}")
    finally:
        a.close()
        b.close()


def test_invalid_nicknames():
    s = connect()
    try:
        recv_frame(s)  # WELCOME
        cases = [
            (b"/nick", b"ERR NICK_EMPTY"),
            (b"/nick has space", b"ERR NICK_INVALID"),
            (b"/nick " + b"x" * 100, b"ERR NICK_INVALID"),
            (b"/nick bad!char", b"ERR NICK_INVALID"),
        ]
        all_ok = True
        details = []
        for cmd, expect_prefix in cases:
            send_frame(s, cmd)
            try:
                resp = recv_matching(s, expect_prefix)
                ok = True
            except AssertionError:
                resp = b"<not found>"
                ok = False
            all_ok &= ok
            details.append(f"{cmd!r} -> {resp!r} (expected prefix {expect_prefix!r})")
        report("invalid_nicknames", all_ok, "; ".join(details))
    finally:
        s.close()


def test_malformed_commands_dont_crash():
    s = connect()
    try:
        recv_frame(s)  # WELCOME
        send_frame(s, b"/bogus command here")
        resp = recv_matching(s, b"ERR BAD_CMD")
        ok1 = resp.startswith(b"ERR BAD_CMD")

        send_frame(s, b"/msg")
        resp2 = recv_matching(s, b"ERR MSG_USAGE")
        ok2 = resp2.startswith(b"ERR MSG_USAGE")

        send_frame(s, b"/msg nobody hello")
        resp3 = recv_matching(s, b"ERR USER_NOT_FOUND")
        ok3 = resp3.startswith(b"ERR USER_NOT_FOUND")

        send_frame(s, b"")  # empty payload, should just be silently ignored
        send_frame(s, b"/list")
        resp4 = recv_matching(s, b"LIST")
        ok4 = resp4.startswith(b"LIST")

        report("malformed_commands_dont_crash", ok1 and ok2 and ok3 and ok4,
               f"{resp!r} {resp2!r} {resp3!r} {resp4!r}")
    finally:
        s.close()


def test_private_message():
    a = connect()
    b = connect()
    try:
        recv_frame(a)
        recv_frame(b)

        send_frame(a, b"/nick sender1")
        recv_matching(a, b"NICK "); recv_matching(b, b"NICK ")
        send_frame(b, b"/nick receiver1")
        recv_matching(a, b"NICK "); recv_matching(b, b"NICK ")

        send_frame(a, b"/msg receiver1 secret hello")
        got_by_b = recv_matching(b, b"PRIV sender1")
        got_by_a = recv_matching(a, b"PRIV_SENT receiver1")

        ok = got_by_b == b"PRIV sender1 secret hello" and got_by_a == b"PRIV_SENT receiver1 secret hello"
        report("private_message", ok, f"b saw {got_by_b!r}, a saw {got_by_a!r}")
    finally:
        a.close()
        b.close()


def test_fragmented_frame():
    """Sends one command one byte at a time to exercise partial send/recv
    handling and TCP fragmentation in recv_exact()."""
    s = connect()
    try:
        recv_frame(s)  # WELCOME
        send_frame_fragmented(s, b"/nick fragbot", delay=0.005)
        # An unrelated client's SYS join/leave notice (e.g. the previous
        # test's idle-probe disconnecting) can legitimately land here
        # first; scan for our own NICK confirmation rather than assuming
        # it's the very next frame.
        resp = recv_matching(s, b"NICK ")
        report("fragmented_frame", resp.startswith(b"NICK ") and b"fragbot" in resp,
               f"got {resp!r}")
    finally:
        s.close()


def test_coalesced_frames():
    """Sends two full frames back-to-back in a single sendall() call so
    they are very likely delivered to the server in one recv(); verifies
    recv_frame() correctly parses both without mixing them up."""
    s = connect()
    try:
        recv_frame(s)  # WELCOME
        combined = encode_frame(b"/nick coala") + encode_frame(b"/list")
        s.sendall(combined)
        # Same interleaving risk as above: scan for each expected
        # response by content instead of assuming positions 1 and 2.
        resp1 = recv_matching(s, b"NICK ")
        resp2 = recv_matching(s, b"LIST")
        ok = resp1.startswith(b"NICK ") and resp2.startswith(b"LIST") and b"coala" in resp2
        report("coalesced_frames", ok, f"{resp1!r} {resp2!r}")
    finally:
        s.close()


def test_oversized_frame_rejected():
    s = connect()
    try:
        recv_frame(s)  # WELCOME
        # Declare a length far beyond MAX_MESSAGE_SIZE; server must reject
        # based on the header alone, without trying to read/allocate it.
        huge_header = struct.pack(">I", TEST_MAX_MESSAGE_SIZE * 100)
        s.sendall(huge_header)

        # An unrelated client's SYS join/leave notice can legitimately land
        # here too; skip past anything that isn't our rejection.
        s.settimeout(2)
        ok = False
        resp = b""
        try:
            for _ in range(10):
                resp = recv_frame(s)
                if resp.startswith(b"ERR FRAME_TOO_LARGE"):
                    ok = True
                    break
        except ConnectionError:
            pass

        # server should then close the connection
        closed = False
        try:
            recv_frame(s)
        except ConnectionError:
            closed = True
        except socket.timeout:
            closed = False
        report("oversized_frame_rejected", ok and closed, f"resp={resp!r} closed={closed}")
    finally:
        s.close()


def test_disconnect_notifies_others():
    a = connect()
    b = connect()
    try:
        recv_frame(a)
        recv_frame(b)

        send_frame(a, b"/nick departing")
        recv_matching(a, b"NICK "); recv_matching(b, b"NICK ")

        a.close()
        msg = recv_matching(b, b"SYS departing has left")
        report("disconnect_notifies_others", b"departing has left" in msg, f"got {msg!r}")
    finally:
        b.close()


def test_exit_command():
    s = connect()
    try:
        recv_frame(s)
        send_frame(s, b"/exit")
        # server should close (or at least stop responding); reading should
        # hit EOF, though an unrelated client's SYS notice may legitimately
        # be interleaved first and needs draining before that happens.
        s.settimeout(2)
        ok = False
        detail = "server sent 10 frames without closing"
        try:
            for _ in range(10):
                recv_frame(s)
        except ConnectionError:
            ok = True
            detail = "connection closed as expected"
        except socket.timeout:
            detail = "timed out waiting for server to close"
        report("exit_command_closes_session", ok, detail)
    finally:
        s.close()


def test_multiple_clients_and_list():
    n = 5
    socks = []
    try:
        for i in range(n):
            s = connect()
            recv_frame(s)  # WELCOME
            socks.append(s)
        # No need to drain each socket's queued SYS join notices: only
        # socks[-1]'s /list response below is actually checked.

        send_frame(socks[-1], b"/list")
        resp = recv_matching(socks[-1], b"LIST ")
        parts = resp.split(b" ")
        count = int(parts[1]) if len(parts) > 1 else -1
        report("multiple_clients_and_list", count == n, f"expected {n}, got {resp!r}")
    finally:
        for s in socks:
            s.close()


def test_server_full_rejection():
    # MAX_CLIENTS=10 in test config; open 10 to fill, then 1 more should be rejected.
    socks = []
    try:
        for i in range(10):
            s = connect()
            recv_frame(s)
            socks.append(s)
        extra = connect()
        resp = recv_frame(extra)
        ok = resp.startswith(b"ERR SERVER_FULL")
        extra.close()
        report("server_full_rejection", ok, f"got {resp!r}")
    finally:
        for s in socks:
            s.close()


def test_shutdown_closes_clients_and_process(server: ServerProcess):
    s = connect()
    try:
        recv_frame(s)  # WELCOME
        exit_code = server.shutdown_via_stdin(timeout=5)
        # A stray SYS from an unrelated client disconnecting around the same
        # moment (e.g. the previous test's settle probe) can legitimately
        # arrive first; skip past anything that isn't the shutdown notice.
        got_sys = False
        msg = b""
        for _ in range(10):
            try:
                msg = recv_frame(s)
            except ConnectionError:
                break
            if b"shutting down" in msg.lower():
                got_sys = True
                break
        s.settimeout(2)
        try:
            trailing = s.recv(4)
            closed = trailing == b""
        except socket.timeout:
            closed = False
        report("shutdown_notifies_and_closes", got_sys and closed,
               f"msg={msg!r} closed={closed}")
        report("shutdown_process_exits_cleanly", exit_code == 0, f"exit_code={exit_code}")
    finally:
        try:
            s.close()
        except OSError:
            pass


def wait_until_server_idle(timeout=3.0):
    """Blocks until the server reports zero connected clients (other than
    our own probe). Each test connects/disconnects its own sockets, but the
    server's handler threads reap a disconnect asynchronously; without
    waiting for that to finish, a slow reap can bleed a stray SYS message
    or a claimed default nickname into the next test. Uses a throwaway
    probe connection + /list to observe real server-side state rather than
    guessing with a fixed sleep.

    The probe itself has to tolerate the very churn it's observing: while
    a previous test's clients are still being reaped, it may see
    ERR SERVER_FULL instead of WELCOME, or unrelated SYS join/leave frames
    interleaved before its LIST response. Both are treated as "not settled
    yet, retry" rather than errors.
    """
    deadline = time.time() + timeout
    last_count = None
    while time.time() < deadline:
        try:
            probe = connect()
            probe.settimeout(0.5)
            try:
                first = recv_frame(probe)
                if not first.startswith(b"WELCOME"):
                    continue  # e.g. ERR SERVER_FULL while old clients still linger
                send_frame(probe, b"/list")
                for _ in range(10):
                    resp = recv_frame(probe)
                    if resp.startswith(b"LIST "):
                        parts = resp.split(b" ")
                        last_count = int(parts[1])
                        if last_count == 1:  # only the probe itself
                            return
                        break
            finally:
                probe.close()
        except (ConnectionError, OSError, ValueError, socket.timeout):
            pass
        time.sleep(0.05)
    raise TimeoutError(f"server did not settle to 0 clients in time (last saw {last_count})")


def run_test(fn, *args):
    fn(*args)
    wait_until_server_idle()


def main():
    if not os.path.isfile(SERVER_BIN):
        print(f"server binary not found at {SERVER_BIN}; run `make` first", file=sys.stderr)
        return 1

    print(f"Using server binary: {SERVER_BIN}")
    server = ServerProcess()
    print(f"Server started on port {TEST_PORT}, log: {server.log_path}")

    try:
        run_test(test_basic_connect_and_welcome)
        run_test(test_nick_change_and_broadcast)
        run_test(test_duplicate_nickname_rejected)
        run_test(test_invalid_nicknames)
        run_test(test_malformed_commands_dont_crash)
        run_test(test_private_message)
        run_test(test_fragmented_frame)
        run_test(test_coalesced_frames)
        run_test(test_oversized_frame_rejected)
        run_test(test_disconnect_notifies_others)
        run_test(test_exit_command)
        run_test(test_multiple_clients_and_list)
        run_test(test_server_full_rejection)
        # Shutdown test must run last: it terminates the server process.
        test_shutdown_closes_clients_and_process(server)
    except Exception as e:
        report("unexpected_exception", False, repr(e))
        traceback.print_exc()
    finally:
        server.kill()
        print(f"\n--- server log ({server.log_path}) ---")
        with open(server.log_path) as f:
            print(f.read())

    print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
    if FAIL:
        print("Failed: " + ", ".join(FAIL))
    return 0 if not FAIL else 1


if __name__ == "__main__":
    sys.exit(main())
