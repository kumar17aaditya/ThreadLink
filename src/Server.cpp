#include "Server.h"
#include <iostream>
#include <fstream>
#include <string>
#include <vector>
#include <map>
#include <cstring>
#include <unistd.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <sys/select.h>
#include <thread>
#include <mutex>
#include <algorithm>
#include <sstream>
#include <atomic>
#include <limits>

using namespace std;

// --- Constructor ---
Server::Server() : is_running(true) {
    load_configuration();
}

// --- Public Methods ---
void Server::run() {
    setup_server();
    accept_connections();
}

// --- Private Helper Methods ---

void Server::load_configuration() {
    ifstream config_file("server.conf");
    string line;
    
    // Set a default port in case the file or key is missing
    this->port = 8080;

    if (config_file.is_open()) {
        while (getline(config_file, line)) {
            stringstream ss(line);
            string key, value;
            if (getline(ss, key, '=') && getline(ss, value)) {
                if (key == "PORT") {
                    try {
                        this->port = stoi(value);
                    } catch (const std::exception& e) {
                        cerr << "Warning: Invalid PORT value in server.conf. Using default 8080." << endl;
                    }
                }
            }
        }
        config_file.close();
    } else {
        cout << "Info: server.conf not found. Using default port 8080." << endl;
    }
}

void Server::setup_server() {
    struct sockaddr_in address;

    if ((server_fd = socket(AF_INET, SOCK_STREAM, 0)) == 0) {
        perror("socket failed"); exit(EXIT_FAILURE);
    }

    int opt = 1;
    if (setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt))) {
        perror("setsockopt"); exit(EXIT_FAILURE);
    }

    address.sin_family = AF_INET;
    address.sin_addr.s_addr = INADDR_ANY;
    address.sin_port = htons(port);

    if (::bind(server_fd, (struct sockaddr *)&address, sizeof(address)) < 0) {
        perror("bind failed"); exit(EXIT_FAILURE);
    }

    if (listen(server_fd, 10) < 0) {
        perror("listen"); exit(EXIT_FAILURE);
    }

    cout << "Server listening on port " << port << "..." << endl;
    cout << "Type 'SHUTDOWN' to close the server." << endl;
}

void Server::accept_connections() {
    while (is_running) {
        fd_set read_fds;
        FD_ZERO(&read_fds);
        FD_SET(server_fd, &read_fds);
        FD_SET(STDIN_FILENO, &read_fds);

        int fdmax = (server_fd > STDIN_FILENO) ? server_fd : STDIN_FILENO;

        if (select(fdmax + 1, &read_fds, NULL, NULL, NULL) == -1) {
            if (!is_running) break;
            perror("select"); continue;
        }

        if (FD_ISSET(STDIN_FILENO, &read_fds)) {
            string command;
            getline(cin, command); // FIX: Use getline to read the full command
            if (command == "SHUTDOWN") {
                cout << "Shutdown command received. Closing server." << endl;
                is_running = false;
            } else {
                cout << "Unknown command: " << command << endl;
            }
        }
        
        if (FD_ISSET(server_fd, &read_fds)) {
            int new_socket = accept(server_fd, nullptr, nullptr);
            if (new_socket < 0) {
                perror("accept"); continue;
            }

            int user_id = 1;
            string default_name = "User" + to_string(user_id);
            {
                lock_guard<mutex> guard(mtx);
                while (find_if(clients.begin(), clients.end(), [&](const auto& pair) { return pair.second == default_name; }) != clients.end()) {
                    user_id++;
                    default_name = "User" + to_string(user_id);
                }
            }
            {
                lock_guard<mutex> guard(mtx);
                clients[new_socket] = default_name;
            }
            cout << "New connection on socket " << new_socket << " as " << default_name << endl;
            string welcome_msg = "Server: " + default_name + " has joined.";
            broadcast_message(welcome_msg, -1); // FIX: Notify all clients, not just others

            // Send a welcome message to the new client as well
            string personal_msg = "Welcome! Your nickname is " + default_name + ". Use 'NICK <name>' to change.";
            send(new_socket, personal_msg.c_str(), personal_msg.length(), 0);

            thread t([this, new_socket] { this->handle_client(new_socket); });
            t.detach();
        }
    }

    cout << "Notifying clients of shutdown..." << endl;
    broadcast_message("Server: Shutting down now. Goodbye!", -1);

    cout << "Closing all sockets..." << endl;
    {
        lock_guard<mutex> guard(mtx);
        for(auto const& [socket, name] : clients) {
            close(socket);
        }
        clients.clear();
    }
    
    close(server_fd);
    cout << "Server closed." << endl;
}

void Server::handle_client(int client_socket) {
    char buffer[1024];
    
    int bytes_received;
    while (is_running && (bytes_received = recv(client_socket, buffer, 1024, 0)) > 0) {
        string received_msg(buffer, bytes_received);
        stringstream ss(received_msg);
        string command;
        ss >> command;

        if (command == "NICK") {
            string new_nickname;
            if (ss >> new_nickname) {
                string notification;
                {
                    lock_guard<mutex> guard(mtx);
                    string old_nickname = clients.at(client_socket);
                    clients[client_socket] = new_nickname;
                    notification = "Server: " + old_nickname + " is now known as " + new_nickname + ".";
                }
                cout << notification << endl;
                broadcast_message(notification, -1);
            }
        } else if (command == "MSG") {
            string recipient_nick;
            ss >> recipient_nick;
            string private_msg;
            getline(ss, private_msg);

            if (!private_msg.empty()) {
                private_msg = private_msg.substr(1); // Remove leading space
                int recipient_socket = -1;
                string sender_nick;
                {
                    lock_guard<mutex> guard(mtx);
                    sender_nick = clients.at(client_socket);
                    for (auto const& [socket, name] : clients) {
                        if (name == recipient_nick) {
                            recipient_socket = socket;
                            break;
                        }
                    }
                }

                if (recipient_socket != -1) {
                    string formatted_msg = "(private) " + sender_nick + ": " + private_msg;
                    send(recipient_socket, formatted_msg.c_str(), formatted_msg.length(), 0);
                } else {
                    string error_msg = "Server: Error - User '" + recipient_nick + "' not found.";
                    send(client_socket, error_msg.c_str(), error_msg.length(), 0);
                }
            }
        } else if (command == "LIST") {
            string user_list = "Server: Users online - ";
            {
                lock_guard<mutex> guard(mtx);
                for (auto const& [socket, name] : clients) { user_list += name + ", "; }
            }
            if (user_list.length() > 22) { user_list = user_list.substr(0, user_list.length() - 2); }
            send(client_socket, user_list.c_str(), user_list.length(), 0);
        } else {
            string public_msg;
            {
                lock_guard<mutex> guard(mtx);
                public_msg = clients.at(client_socket) + ": " + received_msg;
            }
            cout << public_msg << endl;
            broadcast_message(public_msg, client_socket);
        }
        memset(buffer, 0, 1024);
    }

    string goodbye_msg;
    {
        lock_guard<mutex> guard(mtx);
        if (clients.count(client_socket)) {
            goodbye_msg = "Server: " + clients.at(client_socket) + " has left.";
            clients.erase(client_socket);
        }
    }
    if (!goodbye_msg.empty()) {
        cout << goodbye_msg << endl;
        broadcast_message(goodbye_msg, -1);
    }
    close(client_socket);
}

void Server::broadcast_message(const std::string& message, int sender_socket) {
    lock_guard<mutex> guard(mtx);
    for (auto const& [socket, name] : clients) {
        if (socket != sender_socket) {
            send(socket, message.c_str(), message.length(), 0);
        }
    }
}