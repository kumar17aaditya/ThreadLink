#include "Config.h"
#include "Log.h"

#include <fstream>
#include <sstream>
#include <stdexcept>

namespace threadlink {

namespace {

constexpr int MIN_PORT = 1;
constexpr int MAX_PORT = 65535;
constexpr int MIN_MAX_CLIENTS = 1;
constexpr int MAX_MAX_CLIENTS = 10000;
constexpr uint32_t MIN_MAX_MESSAGE_SIZE = 64;
constexpr uint32_t MAX_MAX_MESSAGE_SIZE = 16u * 1024 * 1024; // 16 MiB hard ceiling

std::string trim(const std::string& s) {
    size_t start = s.find_first_not_of(" \t\r\n");
    if (start == std::string::npos) return "";
    size_t end = s.find_last_not_of(" \t\r\n");
    return s.substr(start, end - start + 1);
}

void apply_port(Config& cfg, const std::string& value) {
    try {
        size_t idx = 0;
        int v = std::stoi(value, &idx);
        if (idx != value.size() || v < MIN_PORT || v > MAX_PORT) throw std::out_of_range("range");
        cfg.port = v;
    } catch (const std::exception&) {
        log::warn("server.conf: invalid PORT '" + value + "', keeping default " + std::to_string(cfg.port));
    }
}

void apply_max_clients(Config& cfg, const std::string& value) {
    try {
        size_t idx = 0;
        int v = std::stoi(value, &idx);
        if (idx != value.size() || v < MIN_MAX_CLIENTS || v > MAX_MAX_CLIENTS) throw std::out_of_range("range");
        cfg.max_clients = v;
    } catch (const std::exception&) {
        log::warn("server.conf: invalid MAX_CLIENTS '" + value + "', keeping default " + std::to_string(cfg.max_clients));
    }
}

void apply_max_message_size(Config& cfg, const std::string& value) {
    try {
        size_t idx = 0;
        long long v = std::stoll(value, &idx);
        if (idx != value.size() || v < MIN_MAX_MESSAGE_SIZE || v > MAX_MAX_MESSAGE_SIZE) throw std::out_of_range("range");
        cfg.max_message_size = static_cast<uint32_t>(v);
    } catch (const std::exception&) {
        log::warn("server.conf: invalid MAX_MESSAGE_SIZE '" + value + "', keeping default " + std::to_string(cfg.max_message_size));
    }
}

} // namespace

Config load_config(const std::string& path) {
    Config cfg;

    std::ifstream file(path);
    if (!file.is_open()) {
        log::info("server.conf not found at '" + path + "', using built-in defaults.");
        return cfg;
    }

    std::string line;
    int line_no = 0;
    while (std::getline(file, line)) {
        ++line_no;
        std::string trimmed = trim(line);
        if (trimmed.empty() || trimmed[0] == '#') continue;

        size_t eq = trimmed.find('=');
        if (eq == std::string::npos) {
            log::warn("server.conf:" + std::to_string(line_no) + ": ignoring malformed line '" + trimmed + "'");
            continue;
        }

        std::string key = trim(trimmed.substr(0, eq));
        std::string value = trim(trimmed.substr(eq + 1));

        if (key == "PORT") apply_port(cfg, value);
        else if (key == "MAX_CLIENTS") apply_max_clients(cfg, value);
        else if (key == "MAX_MESSAGE_SIZE") apply_max_message_size(cfg, value);
        else if (key == "LOG_LEVEL") cfg.log_level = value;
        else log::warn("server.conf:" + std::to_string(line_no) + ": unknown key '" + key + "'");
    }

    return cfg;
}

} // namespace threadlink
