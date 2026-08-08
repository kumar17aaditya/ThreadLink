#ifndef THREADLINK_SERVER_H
#define THREADLINK_SERVER_H

#include "Config.h"

#include <atomic>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

namespace threadlink {

// Thread-per-client TCP chat server speaking the ThreadLink framed protocol
// (see docs/PROTOCOL.md). One thread reads frames from a client and applies
// them under a single lock scope; shared state is a plain map guarded by a
// mutex, and network I/O is always done outside that lock via per-client
// write mutexes so a slow client can't stall broadcasts to everyone else.
class Server {
public:
    explicit Server(Config config);
    ~Server();

    Server(const Server&) = delete;
    Server& operator=(const Server&) = delete;

    // Binds, listens, and runs the accept loop until shutdown is requested
    // (via stdin "SHUTDOWN", SIGINT, or SIGTERM), then joins every client
    // thread before returning. Throws std::runtime_error on setup failure.
    void run();

    // Signals the accept loop to stop. Safe to call from a signal handler.
    void request_shutdown() noexcept;

private:
    struct ClientRecord {
        std::string nickname;
        std::shared_ptr<std::mutex> write_mutex;
        // False until this client's own WELCOME frame has been sent.
        // broadcast() skips not-yet-welcomed clients so that no other
        // thread's message can race ahead of a client's own WELCOME on
        // its socket (both are guarded by clients_mtx_).
        bool welcomed = false;
    };

    struct ThreadEntry {
        int fd;
        std::thread thread;
    };

    void setup_listener();
    void accept_loop();
    void accept_one();
    void handle_client(int fd);
    void reap_finished_threads();
    void shutdown_all();

    // Messaging helpers. These look up state under clients_mtx_ but always
    // perform the actual send() outside of it, holding only the target
    // client's own write_mutex.
    void broadcast(const std::string& payload, int exclude_fd);
    bool send_to_fd(int fd, const std::string& payload);
    void send_error(int fd, const std::string& code, const std::string& text);

    // Command handlers, invoked from the owning client's thread.
    // Returns false if the client connection should be closed (i.e. /exit).
    bool handle_line(int fd, const std::string& raw);
    void handle_nick(int fd, const std::string& args);
    void handle_msg(int fd, const std::string& args);
    void handle_list(int fd);

    static bool is_valid_nickname(const std::string& nick);
    // Precondition: caller holds clients_mtx_.
    std::string assign_default_nickname_locked() const;

    Config config_;
    int listen_fd_ = -1;
    bool stdin_open_ = true;

    std::mutex clients_mtx_;
    std::unordered_map<int, ClientRecord> clients_;

    std::mutex threads_mtx_;
    std::vector<ThreadEntry> client_threads_;

    std::atomic<bool> running_{false};
};

} // namespace threadlink

#endif // THREADLINK_SERVER_H
