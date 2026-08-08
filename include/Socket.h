#ifndef THREADLINK_SOCKET_H
#define THREADLINK_SOCKET_H

#include <unistd.h>
#include <utility>

namespace threadlink {

// RAII ownership wrapper around a POSIX socket file descriptor.
// Non-copyable, movable, closes automatically exactly once.
class Socket {
public:
    Socket() noexcept : fd_(-1) {}
    explicit Socket(int fd) noexcept : fd_(fd) {}

    ~Socket() { close(); }

    Socket(const Socket&) = delete;
    Socket& operator=(const Socket&) = delete;

    Socket(Socket&& other) noexcept : fd_(other.fd_) { other.fd_ = -1; }

    Socket& operator=(Socket&& other) noexcept {
        if (this != &other) {
            close();
            fd_ = other.fd_;
            other.fd_ = -1;
        }
        return *this;
    }

    int get() const noexcept { return fd_; }
    bool valid() const noexcept { return fd_ >= 0; }
    explicit operator bool() const noexcept { return valid(); }

    // Relinquishes ownership without closing; caller becomes responsible
    // for the fd's lifetime.
    int release() noexcept {
        int fd = fd_;
        fd_ = -1;
        return fd;
    }

    void close() noexcept {
        if (fd_ >= 0) {
            ::close(fd_);
            fd_ = -1;
        }
    }

private:
    int fd_;
};

} // namespace threadlink

#endif // THREADLINK_SOCKET_H
