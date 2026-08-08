#ifndef THREADLINK_PROTOCOL_H
#define THREADLINK_PROTOCOL_H

#include <cstddef>
#include <cstdint>
#include <string>

// Shared wire-protocol layer used by both the server and the terminal client
// (and, in spirit, by any other bridge such as the WebSocket gateway talking
// framed TCP). See docs/PROTOCOL.md for the full contract.
//
// Wire format: [4-byte big-endian uint32 payload length][payload bytes]
// The payload itself is an arbitrary byte string (UTF-8 text in practice).

namespace threadlink {

// Default cap on a single frame's payload size, in bytes. The server
// overrides this from server.conf (MAX_MESSAGE_SIZE); callers that read
// or write frames must pass the effective limit explicitly.
constexpr uint32_t DEFAULT_MAX_MESSAGE_SIZE = 8192;
constexpr size_t FRAME_HEADER_SIZE = 4;

enum class IoStatus {
    Ok,           // completed successfully
    ClosedByPeer, // orderly disconnect (EOF on read, or peer closed)
    Error,        // socket error (treat like a disconnect)
    TooLarge,     // declared/attempted frame length exceeds max_size
};

// Writes exactly `len` bytes from buf to fd. Retries on EINTR and handles
// partial writes. Does not throw; never blocks forever on a well-behaved
// blocking socket beyond what the kernel itself would block for.
IoStatus send_all(int fd, const void* buf, size_t len);

// Reads exactly `len` bytes from fd into buf. Retries on EINTR and handles
// partial reads. Returns ClosedByPeer on orderly EOF before `len` bytes
// were read.
IoStatus recv_exact(int fd, void* buf, size_t len);

// Sends `payload` as a single length-prefixed frame. Returns TooLarge
// without writing anything if payload.size() > max_size.
IoStatus send_frame(int fd, const std::string& payload,
                     uint32_t max_size = DEFAULT_MAX_MESSAGE_SIZE);

// Reads one full frame from fd into `out`. If the declared length exceeds
// max_size, returns TooLarge immediately WITHOUT attempting to allocate or
// read the (potentially bogus/huge) payload, protecting against memory
// exhaustion from a malicious or buggy peer. Caller should close the
// connection on TooLarge.
IoStatus recv_frame(int fd, std::string& out,
                     uint32_t max_size = DEFAULT_MAX_MESSAGE_SIZE);

} // namespace threadlink

#endif // THREADLINK_PROTOCOL_H
