#include "Server.h"
#include <iostream>

int main() {
    try {
        Server chat_server;
        chat_server.run();
    } catch (const std::exception& e) {
        std::cerr << "An unexpected error occurred: " << e.what() << std::endl;
        return 1;
    } catch (...) {
        std::cerr << "An unknown error occurred." << std::endl;
        return 1;
    }
    return 0;
}