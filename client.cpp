#include "Protocol.h"
#include "Socket.h"

#include <algorithm>
#include <arpa/inet.h>
#include <cstring>
#include <iostream>
#include <sstream>
#include <string>
#include <sys/select.h>
#include <sys/socket.h>
#include <unistd.h>

using namespace threadlink;

namespace {

constexpr int DEFAULT_PORT = 8080;
constexpr const char* DEFAULT_HOST = "127.0.0.1";
// Generous local guard against a misbehaving/malicious peer forcing a huge
// allocation; the server's server.conf MAX_MESSAGE_SIZE is authoritative.
constexpr uint32_t CLIENT_MAX_MESSAGE_SIZE = 1u * 1024 * 1024;

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

// Renders one decoded server->client frame payload for the terminal.
void print_server_message(const std::string& payload) {
    std::string type, rest;
    split_first(payload, type, rest);

    if (type == "WELCOME") {
        std::cout << "\r* Connected. Your nickname is '" << rest << "'. Use /nick <name> to change it.\n";
    } else if (type == "SYS") {
        std::cout << "\r* " << rest << "\n";
    } else if (type == "MSG") {
        std::string sender, text;
        split_first(rest, sender, text);
        std::cout << "\r" << sender << ": " << text << "\n";
    } else if (type == "PRIV") {
        std::string sender, text;
        split_first(rest, sender, text);
        std::cout << "\r[PM from " << sender << "] " << text << "\n";
    } else if (type == "PRIV_SENT") {
        std::string target, text;
        split_first(rest, target, text);
        std::cout << "\r[PM to " << target << "] " << text << "\n";
    } else if (type == "NICK") {
        std::string old_nick, new_nick;
        split_first(rest, old_nick, new_nick);
        std::cout << "\r* " << old_nick << " is now known as " << new_nick << "\n";
    } else if (type == "LIST") {
        std::string count, names;
        split_first(rest, count, names);
        std::cout << "\r* Online users (" << count << "): " << names << "\n";
    } else if (type == "ERR") {
        std::string code, text;
        split_first(rest, code, text);
        std::cout << "\r! Error [" << code << "]: " << text << "\n";
    } else {
        std::cout << "\r" << payload << "\n";
    }
    std::cout << "> " << std::flush;
}

} // namespace

int main(int argc, char** argv) {
    std::string host = DEFAULT_HOST;
    int port = DEFAULT_PORT;
    if (argc >= 2) host = argv[1];
    if (argc >= 3) {
        try {
            port = std::stoi(argv[2]);
        } catch (const std::exception&) {
            std::cerr << "Invalid port '" << argv[2] << "', using default " << DEFAULT_PORT << "\n";
            port = DEFAULT_PORT;
        }
    }

    int raw_fd = ::socket(AF_INET, SOCK_STREAM, 0);
    if (raw_fd < 0) {
        std::cerr << "Socket creation error: " << std::strerror(errno) << "\n";
        return 1;
    }
    Socket sock(raw_fd);

    sockaddr_in serv_addr{};
    serv_addr.sin_family = AF_INET;
    serv_addr.sin_port = htons(static_cast<uint16_t>(port));
    if (::inet_pton(AF_INET, host.c_str(), &serv_addr.sin_addr) <= 0) {
        std::cerr << "Invalid address: " << host << "\n";
        return 1;
    }
    if (::connect(sock.get(), reinterpret_cast<sockaddr*>(&serv_addr), sizeof(serv_addr)) < 0) {
        std::cerr << "Connection failed: " << std::strerror(errno) << "\n";
        return 1;
    }

    std::cout << "Connected to ThreadLink server at " << host << ":" << port << "\n";
    std::cout << "Commands: /nick <name>   /msg <name> <message>   /list   /exit\n";
    std::cout << "> " << std::flush;

    while (true) {
        fd_set read_fds;
        FD_ZERO(&read_fds);
        FD_SET(STDIN_FILENO, &read_fds);
        FD_SET(sock.get(), &read_fds);
        int fdmax = std::max(STDIN_FILENO, sock.get());

        if (::select(fdmax + 1, &read_fds, nullptr, nullptr, nullptr) < 0) {
            if (errno == EINTR) continue;
            std::cerr << "select() failed: " << std::strerror(errno) << "\n";
            break;
        }

        if (FD_ISSET(sock.get(), &read_fds)) {
            std::string payload;
            IoStatus status = recv_frame(sock.get(), payload, CLIENT_MAX_MESSAGE_SIZE);
            if (status == IoStatus::ClosedByPeer || status == IoStatus::Error) {
                std::cout << "\nServer disconnected.\n";
                break;
            }
            if (status == IoStatus::TooLarge) {
                std::cout << "\nServer sent an oversized frame; disconnecting.\n";
                break;
            }
            print_server_message(payload);
        }

        if (FD_ISSET(STDIN_FILENO, &read_fds)) {
            std::string line;
            if (!std::getline(std::cin, line)) {
                break; // stdin closed (EOF)
            }
            if (line == "/exit") {
                send_frame(sock.get(), "/exit", CLIENT_MAX_MESSAGE_SIZE);
                break;
            }
            if (!line.empty()) {
                IoStatus status = send_frame(sock.get(), line, CLIENT_MAX_MESSAGE_SIZE);
                if (status != IoStatus::Ok) {
                    std::cout << "\nFailed to send (connection lost).\n";
                    break;
                }
            }
            std::cout << "> " << std::flush;
        }
    }

    std::cout << "Goodbye.\n";
    return 0;
}
