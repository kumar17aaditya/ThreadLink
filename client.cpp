#include <iostream>
#include <string>
#include <cstring>
#include <unistd.h>
#include <sys/socket.h>
#include <arpa/inet.h>
#include <sys/select.h>

using namespace std;

const int PORT = 8080;
const int BUFFER_SIZE = 1024;

// Function to format user input into protocol commands
string format_command(const string& line) {
    if (line.rfind("/nick ", 0) == 0) { // Check if line starts with "/nick "
        return "NICK " + line.substr(6);
    }
    if (line.rfind("/msg ", 0) == 0) { // Check if line starts with "/msg "
        return "MSG " + line.substr(5);
    }
    if (line == "/list") {
        return "LIST";
    }
    return line; // Not a command, return as is
}

int main() {
    int sock = 0;
    struct sockaddr_in serv_addr;
    char buffer[BUFFER_SIZE] = {0};

    if ((sock = socket(AF_INET, SOCK_STREAM, 0)) < 0) {
        cout << "Socket creation error" << endl; return -1;
    }

    serv_addr.sin_family = AF_INET;
    serv_addr.sin_port = htons(PORT);

    if (inet_pton(AF_INET, "127.0.0.1", &serv_addr.sin_addr) <= 0) {
        cout << "Invalid address/ Address not supported" << endl; return -1;
    }

    if (connect(sock, (struct sockaddr *)&serv_addr, sizeof(serv_addr)) < 0) {
        cout << "Connection Failed" << endl; return -1;
    }

    cout << "Connected to the server. You can start typing." << endl;
    cout << "Commands: /nick <name>, /msg <name> <message>, /list" << endl;

    while (true) {
        fd_set read_fds;
        FD_ZERO(&read_fds);
        FD_SET(STDIN_FILENO, &read_fds);
        FD_SET(sock, &read_fds);
        int fdmax = (STDIN_FILENO > sock) ? STDIN_FILENO : sock;
        
        cout << "> ";
        fflush(stdout);

        if (select(fdmax + 1, &read_fds, NULL, NULL, NULL) == -1) {
            perror("select"); exit(EXIT_FAILURE);
        }

        if (FD_ISSET(sock, &read_fds)) {
            int bytes_received = recv(sock, buffer, BUFFER_SIZE, 0);
            if (bytes_received <= 0) {
                cout << "\nServer disconnected." << endl; break;
            }
            cout << "\r" << string(buffer, bytes_received) << endl; // Use \r to overwrite prompt
            memset(buffer, 0, BUFFER_SIZE);
        }

        if (FD_ISSET(STDIN_FILENO, &read_fds)) {
            string line;
            getline(cin, line);
            if (line == "/exit") {
                break;
            }
            string command = format_command(line);
            send(sock, command.c_str(), command.length(), 0);
        }
    }

    close(sock);
    return 0;
}