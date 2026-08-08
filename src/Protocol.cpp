#include "Protocol.h"

#include <arpa/inet.h>
#include <cerrno>
#include <sys/socket.h>
#include <unistd.h>

namespace threadlink {

IoStatus send_all(int fd, const void* buf, size_t len) {
    const char* p = static_cast<const char*>(buf);
    size_t total = 0;
    while (total < len) {
        ssize_t n = ::send(fd, p + total, len - total, MSG_NOSIGNAL);
        if (n > 0) {
            total += static_cast<size_t>(n);
            continue;
        }
        if (n < 0 && errno == EINTR) continue;
        if (n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) continue;
        return IoStatus::Error;
    }
    return IoStatus::Ok;
}

IoStatus recv_exact(int fd, void* buf, size_t len) {
    char* p = static_cast<char*>(buf);
    size_t total = 0;
    while (total < len) {
        ssize_t n = ::recv(fd, p + total, len - total, 0);
        if (n > 0) {
            total += static_cast<size_t>(n);
            continue;
        }
        if (n == 0) return IoStatus::ClosedByPeer;
        if (errno == EINTR) continue;
        return IoStatus::Error;
    }
    return IoStatus::Ok;
}

IoStatus send_frame(int fd, const std::string& payload, uint32_t max_size) {
    if (payload.size() > max_size) return IoStatus::TooLarge;

    uint32_t len_be = htonl(static_cast<uint32_t>(payload.size()));
    IoStatus status = send_all(fd, &len_be, sizeof(len_be));
    if (status != IoStatus::Ok) return status;

    if (payload.empty()) return IoStatus::Ok;
    return send_all(fd, payload.data(), payload.size());
}

IoStatus recv_frame(int fd, std::string& out, uint32_t max_size) {
    uint32_t len_be = 0;
    IoStatus status = recv_exact(fd, &len_be, sizeof(len_be));
    if (status != IoStatus::Ok) return status;

    uint32_t len = ntohl(len_be);
    if (len > max_size) return IoStatus::TooLarge;

    out.resize(len);
    if (len == 0) return IoStatus::Ok;

    return recv_exact(fd, out.data(), len);
}

} // namespace threadlink
