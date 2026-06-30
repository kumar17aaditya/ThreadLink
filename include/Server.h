#ifndef SERVER_H
#define SERVER_H

#include <string>
#include <map>
#include <thread>
#include <mutex>
#include <atomic>

class Server {
public:
    // Constructor no longer takes a port
    Server();

    void run();

private:
    int port;
    int server_fd;
    std::map<int, std::string> clients;
    std::mutex mtx;
    std::atomic<bool> is_running;

    // New private method to load settings
    void load_configuration();
    
    void setup_server();
    void accept_connections();
    void handle_client(int client_socket);
    void broadcast_message(const std::string& message, int sender_socket = -1);
};

#endif // SERVER_H