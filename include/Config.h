#ifndef THREADLINK_CONFIG_H
#define THREADLINK_CONFIG_H

#include "Protocol.h"

#include <cstdint>
#include <string>

namespace threadlink {

struct Config {
    int port = 8080;
    int max_clients = 100;
    uint32_t max_message_size = DEFAULT_MAX_MESSAGE_SIZE;
    std::string log_level = "INFO";
};

// Loads KEY=VALUE pairs from `path` (blank lines and lines starting with
// '#' are ignored). Missing file, missing keys, or out-of-range/malformed
// values all fall back to defaults; invalid values are logged as warnings.
// Never throws.
Config load_config(const std::string& path);

} // namespace threadlink

#endif // THREADLINK_CONFIG_H
