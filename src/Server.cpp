#include "Server.h"
#include "Log.h"
#include "Protocol.h"
#include "Socket.h"

#include <algorithm>
#include <arpa/inet.h>
#include <cctype>
#include <cstring>
#include <iostream>
#include <netinet/in.h>
#include <sstream>
#include <stdexcept>
#include <sys/select.h>
#include <sys/socket.h>
#include <unistd.h>

namespace threadlink {

namespace {
constexpr size_t MAX_NICKNAME_LENGTH = 24;
constexpr int LISTEN_BACKLOG = 16;
constexpr timeval ACCEPT_LOOP_POLL_INTERVAL{1, 0}; // seconds, microseconds

// Splits `s` on the first space into (first, remainder). If there is no
// space, remainder is empty. Used to parse "<token> <rest of line>".
void split_first(const std::string& s, std::string& first, std::string& remainder) {
    size_t pos = s.find(' ');
    if (pos == std::string::npos) {
        first = s;
        remainder.clear();
    } else {
        first = s.substr(0, pos);
        remainder = s.substr(pos + 1);
    }
}
} // namespace

Server::Server(Config config) : config_(config) {}

Server::~Server() {
    if (listen_fd_ >= 0) {
        ::close(listen_fd_);
        listen_fd_ = -1;
    }
}

void Server::request_shutdown() noexcept {
    running_.store(false);
}

void Server::run() {
    setup_listener();
    running_.store(true);
    accept_loop();
    shutdown_all();
}

void Server::setup_listener() {
    listen_fd_ = ::socket(AF_INET, SOCK_STREAM, 0);
    if (listen_fd_ < 0) {
        throw std::runtime_error(std::string("socket() failed: ") + std::strerror(errno));
    }

    int opt = 1;
    if (::setsockopt(listen_fd_, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt)) < 0) {
        throw std::runtime_error(std::string("setsockopt(SO_REUSEADDR) failed: ") + std::strerror(errno));
    }

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = INADDR_ANY;
    addr.sin_port = htons(static_cast<uint16_t>(config_.port));

    if (::bind(listen_fd_, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) < 0) {
        std::string err = std::strerror(errno);
        throw std::runtime_error("bind() failed on port " + std::to_string(config_.port) + ": " + err);
    }

    if (::listen(listen_fd_, LISTEN_BACKLOG) < 0) {
        std::string err = std::strerror(errno);
        throw std::runtime_error(std::string("listen() failed: ") + err);
    }

    log::info("ThreadLink server listening on port " + std::to_string(config_.port) +
              " (max_clients=" + std::to_string(config_.max_clients) +
              ", max_message_size=" + std::to_string(config_.max_message_size) + " bytes)");
    log::info("Type SHUTDOWN and press Enter, or send SIGINT/SIGTERM, to stop the server.");
}

void Server::accept_loop() {
    while (running_.load()) {
        fd_set read_fds;
        FD_ZERO(&read_fds);
        FD_SET(listen_fd_, &read_fds);
        if (stdin_open_) FD_SET(STDIN_FILENO, &read_fds);
        int fdmax = std::max(listen_fd_, STDIN_FILENO);

        timeval tv = ACCEPT_LOOP_POLL_INTERVAL; // select() may mutate this, so copy each iteration
        int ready = ::select(fdmax + 1, &read_fds, nullptr, nullptr, &tv);

        if (ready < 0) {
            if (errno == EINTR) continue;
            log::error(std::string("select() failed: ") + std::strerror(errno));
            break;
        }

        reap_finished_threads();

        if (ready == 0) continue; // poll timeout: re-check running_ and loop

        if (stdin_open_ && FD_ISSET(STDIN_FILENO, &read_fds)) {
            std::string command;
            if (!std::getline(std::cin, command)) {
                // stdin closed/EOF (e.g. no controlling terminal): stop
                // selecting on it instead of spinning in a hot loop.
                stdin_open_ = false;
            } else if (command == "SHUTDOWN") {
                log::info("Shutdown command received via console.");
                running_.store(false);
                break;
            } else if (!command.empty()) {
                log::warn("Unknown console command: '" + command + "'");
            }
        }

        if (FD_ISSET(listen_fd_, &read_fds)) {
            accept_one();
        }
    }
}

void Server::accept_one() {
    sockaddr_in addr{};
    socklen_t addr_len = sizeof(addr);
    int raw_fd = ::accept(listen_fd_, reinterpret_cast<sockaddr*>(&addr), &addr_len);
    if (raw_fd < 0) {
        if (errno != EINTR && errno != EAGAIN && errno != ECONNABORTED) {
            log::warn(std::string("accept() failed: ") + std::strerror(errno));
        }
        return;
    }
    Socket sock(raw_fd);

    char ip[INET_ADDRSTRLEN] = {0};
    ::inet_ntop(AF_INET, &addr.sin_addr, ip, sizeof(ip));
    std::string peer = std::string(ip) + ":" + std::to_string(ntohs(addr.sin_port));

    std::string nickname;
    bool full;
    {
        std::lock_guard<std::mutex> lock(clients_mtx_);
        full = static_cast<int>(clients_.size()) >= config_.max_clients;
        if (!full) {
            nickname = assign_default_nickname_locked();
            clients_.emplace(sock.get(), ClientRecord{nickname, std::make_shared<std::mutex>()});
        }
    }

    if (full) {
        log::warn("Rejecting connection from " + peer + ": server full (" +
                  std::to_string(config_.max_clients) + " max clients)");
        send_frame(sock.get(), "ERR SERVER_FULL Server is full, try again later", config_.max_message_size);
        return; // Socket destructor closes the fd
    }

    log::info("Client connected from " + peer + ", assigned nickname '" + nickname + "'");

    int fd = sock.release(); // ownership moves to the handler thread

    // Send WELCOME before this client becomes reachable by anyone else: it
    // is not yet marked `welcomed` (so broadcast() skips it as a target)
    // and its handler thread hasn't started yet (so it can't even race
    // itself by responding to a command before WELCOME lands). This
    // guarantees WELCOME is always the first frame a client receives.
    send_to_fd(fd, "WELCOME " + nickname);
    {
        std::lock_guard<std::mutex> lock(clients_mtx_);
        auto it = clients_.find(fd);
        if (it != clients_.end()) it->second.welcomed = true;
    }

    {
        std::lock_guard<std::mutex> lock(threads_mtx_);
        client_threads_.push_back(ThreadEntry{fd, std::thread(&Server::handle_client, this, fd)});
    }

    broadcast("SYS " + nickname + " has joined.", fd);
}

void Server::handle_client(int fd) {
    Socket sock(fd); // owns the fd for the lifetime of this thread

    // Deliberately not gated on running_: shutdown_all() sends its goodbye
    // broadcast, THEN calls ::shutdown(fd, SHUT_RDWR) to unblock recv_frame()
    // below with ClosedByPeer, which is what ends this loop during a
    // graceful shutdown. If this loop also checked running_ directly, a
    // just-spawned thread that hasn't run yet when running_ flips to false
    // would skip straight to teardown (erasing itself and closing fd) and
    // could race shutdown_all()'s broadcast trying to write to that same fd.
    while (true) {
        std::string payload;
        IoStatus status = recv_frame(fd, payload, config_.max_message_size);

        if (status == IoStatus::ClosedByPeer) {
            log::debug("fd=" + std::to_string(fd) + " closed the connection.");
            break;
        }
        if (status == IoStatus::Error) {
            log::debug("fd=" + std::to_string(fd) + " recv error, disconnecting.");
            break;
        }
        if (status == IoStatus::TooLarge) {
            log::warn("fd=" + std::to_string(fd) + " sent an oversized frame; disconnecting.");
            send_to_fd(fd, "ERR FRAME_TOO_LARGE Message exceeds the server's maximum size");
            break;
        }

        if (!handle_line(fd, payload)) break; // /exit
    }

    std::string leaving_nick;
    {
        std::lock_guard<std::mutex> lock(clients_mtx_);
        auto it = clients_.find(fd);
        if (it != clients_.end()) {
            leaving_nick = it->second.nickname;
            clients_.erase(it);
        }
    }
    if (!leaving_nick.empty()) {
        log::info("Client '" + leaving_nick + "' (fd=" + std::to_string(fd) + ") disconnected.");
        broadcast("SYS " + leaving_nick + " has left.", fd);
    }
    // Socket destructor closes fd here, exactly once.
}

bool Server::handle_line(int fd, const std::string& raw) {
    std::string line = raw;
    while (!line.empty() && (line.back() == '\r' || line.back() == '\n')) line.pop_back();

    if (line.empty()) return true; // ignore blank input

    if (line[0] == '/') {
        std::string cmd, rest;
        split_first(line, cmd, rest);

        if (cmd == "/nick") {
            handle_nick(fd, rest);
        } else if (cmd == "/msg") {
            handle_msg(fd, rest);
        } else if (cmd == "/list") {
            handle_list(fd);
        } else if (cmd == "/exit") {
            log::debug("fd=" + std::to_string(fd) + " requested /exit.");
            return false;
        } else {
            send_error(fd, "BAD_CMD", "Unknown command '" + cmd + "'");
        }
        return true;
    }

    std::string sender;
    {
        std::lock_guard<std::mutex> lock(clients_mtx_);
        auto it = clients_.find(fd);
        if (it == clients_.end()) return true;
        sender = it->second.nickname;
    }
    log::debug(sender + ": " + line);
    broadcast("MSG " + sender + " " + line, fd);
    return true;
}

void Server::handle_nick(int fd, const std::string& args) {
    std::istringstream iss(args);
    std::string new_nick;
    iss >> new_nick;
    std::string trailing_junk;
    if (iss >> trailing_junk) {
        send_error(fd, "NICK_INVALID", "Nickname must not contain spaces");
        return;
    }
    if (new_nick.empty()) {
        send_error(fd, "NICK_EMPTY", "Usage: /nick <name>");
        return;
    }
    if (!is_valid_nickname(new_nick)) {
        send_error(fd, "NICK_INVALID",
                   "Nickname must be 1-" + std::to_string(MAX_NICKNAME_LENGTH) +
                       " characters: letters, digits, '_' or '-' only");
        return;
    }

    std::string old_nick;
    bool taken = false;
    {
        std::lock_guard<std::mutex> lock(clients_mtx_);
        for (auto& [other_fd, rec] : clients_) {
            if (other_fd != fd && rec.nickname == new_nick) {
                taken = true;
                break;
            }
        }
        if (!taken) {
            auto it = clients_.find(fd);
            if (it == clients_.end()) return;
            old_nick = it->second.nickname;
            it->second.nickname = new_nick;
        }
    }

    if (taken) {
        send_error(fd, "NICK_TAKEN", "Nickname '" + new_nick + "' is already in use");
        return;
    }

    log::info("Nickname change: '" + old_nick + "' -> '" + new_nick + "' (fd=" + std::to_string(fd) + ")");
    broadcast("NICK " + old_nick + " " + new_nick, -1);
}

void Server::handle_msg(int fd, const std::string& args) {
    std::string target, text;
    split_first(args, target, text);

    if (target.empty() || text.empty()) {
        send_error(fd, "MSG_USAGE", "Usage: /msg <nickname> <message>");
        return;
    }

    std::string sender;
    int target_fd = -1;
    {
        std::lock_guard<std::mutex> lock(clients_mtx_);
        auto self_it = clients_.find(fd);
        if (self_it == clients_.end()) return;
        sender = self_it->second.nickname;
        for (auto& [other_fd, rec] : clients_) {
            if (rec.welcomed && rec.nickname == target) {
                target_fd = other_fd;
                break;
            }
        }
    }

    if (target_fd == -1) {
        send_error(fd, "USER_NOT_FOUND", "User '" + target + "' not found");
        return;
    }
    if (target_fd == fd) {
        send_error(fd, "MSG_SELF", "You cannot send a private message to yourself");
        return;
    }

    send_to_fd(target_fd, "PRIV " + sender + " " + text);
    send_to_fd(fd, "PRIV_SENT " + target + " " + text);
}

void Server::handle_list(int fd) {
    std::vector<std::string> names;
    {
        std::lock_guard<std::mutex> lock(clients_mtx_);
        names.reserve(clients_.size());
        for (auto& [other_fd, rec] : clients_) {
            if (rec.welcomed) names.push_back(rec.nickname);
        }
    }
    std::sort(names.begin(), names.end());

    std::string payload = "LIST " + std::to_string(names.size());
    for (auto& n : names) payload += " " + n;
    send_to_fd(fd, payload);
}

bool Server::is_valid_nickname(const std::string& nick) {
    if (nick.empty() || nick.size() > MAX_NICKNAME_LENGTH) return false;
    for (char c : nick) {
        if (!(std::isalnum(static_cast<unsigned char>(c)) || c == '_' || c == '-')) return false;
    }
    return true;
}

std::string Server::assign_default_nickname_locked() const {
    int n = 1;
    std::string name;
    do {
        name = "User" + std::to_string(n++);
    } while (std::any_of(clients_.begin(), clients_.end(),
                          [&](const auto& kv) { return kv.second.nickname == name; }));
    return name;
}

bool Server::send_to_fd(int fd, const std::string& payload) {
    std::shared_ptr<std::mutex> write_mutex;
    {
        std::lock_guard<std::mutex> lock(clients_mtx_);
        auto it = clients_.find(fd);
        if (it == clients_.end()) return false;
        write_mutex = it->second.write_mutex;
    }
    std::lock_guard<std::mutex> send_lock(*write_mutex);
    return send_frame(fd, payload, config_.max_message_size) == IoStatus::Ok;
}

void Server::send_error(int fd, const std::string& code, const std::string& text) {
    send_to_fd(fd, "ERR " + code + " " + text);
}

void Server::broadcast(const std::string& payload, int exclude_fd) {
    std::vector<std::pair<int, std::shared_ptr<std::mutex>>> targets;
    {
        std::lock_guard<std::mutex> lock(clients_mtx_);
        targets.reserve(clients_.size());
        for (auto& [fd, rec] : clients_) {
            if (fd != exclude_fd && rec.welcomed) targets.emplace_back(fd, rec.write_mutex);
        }
    }
    for (auto& [fd, write_mutex] : targets) {
        std::lock_guard<std::mutex> send_lock(*write_mutex);
        send_frame(fd, payload, config_.max_message_size);
    }
}

void Server::reap_finished_threads() {
    std::lock_guard<std::mutex> lock(threads_mtx_);
    for (auto it = client_threads_.begin(); it != client_threads_.end();) {
        bool still_active;
        {
            std::lock_guard<std::mutex> clients_lock(clients_mtx_);
            still_active = clients_.count(it->fd) > 0;
        }
        if (!still_active && it->thread.joinable()) {
            it->thread.join();
            it = client_threads_.erase(it);
        } else {
            ++it;
        }
    }
}

void Server::shutdown_all() {
    log::info("Shutting down: notifying connected clients...");
    broadcast("SYS Server is shutting down. Goodbye!", -1);

    std::vector<int> fds;
    {
        std::lock_guard<std::mutex> lock(clients_mtx_);
        fds.reserve(clients_.size());
        for (auto& [fd, rec] : clients_) fds.push_back(fd);
    }
    for (int fd : fds) {
        ::shutdown(fd, SHUT_RDWR); // unblocks any handler thread stuck in recv_frame
    }

    log::info("Waiting for client threads to finish...");
    std::vector<std::thread> to_join;
    {
        std::lock_guard<std::mutex> lock(threads_mtx_);
        for (auto& entry : client_threads_) to_join.push_back(std::move(entry.thread));
        client_threads_.clear();
    }
    for (auto& t : to_join) {
        if (t.joinable()) t.join();
    }

    ::close(listen_fd_);
    listen_fd_ = -1;
    log::info("Server shut down cleanly.");
}

} // namespace threadlink
