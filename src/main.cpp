#include "Config.h"
#include "Log.h"
#include "Server.h"

#include <csignal>
#include <iostream>

namespace {
threadlink::Server* g_server = nullptr;

extern "C" void handle_signal(int) {
    if (g_server != nullptr) g_server->request_shutdown();
}
} // namespace

int main() {
    std::signal(SIGPIPE, SIG_IGN);

    threadlink::Config config = threadlink::load_config("server.conf");
    threadlink::log::set_min_level_from_string(config.log_level);

    try {
        threadlink::Server server(config);
        g_server = &server;
        std::signal(SIGINT, handle_signal);
        std::signal(SIGTERM, handle_signal);

        server.run();
        g_server = nullptr;
    } catch (const std::exception& e) {
        threadlink::log::error(std::string("Fatal: ") + e.what());
        return 1;
    } catch (...) {
        threadlink::log::error("Fatal: unknown error");
        return 1;
    }

    return 0;
}
