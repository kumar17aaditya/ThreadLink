#include "Log.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <ctime>
#include <iostream>
#include <mutex>

namespace threadlink::log {

namespace {
std::atomic<Level> g_min_level{Level::Info};
std::mutex g_write_mtx;

const char* level_name(Level level) {
    switch (level) {
        case Level::Debug: return "DEBUG";
        case Level::Info:  return "INFO";
        case Level::Warn:  return "WARN";
        case Level::Error: return "ERROR";
    }
    return "?";
}

std::string timestamp() {
    using namespace std::chrono;
    auto now = system_clock::now();
    auto ms = duration_cast<milliseconds>(now.time_since_epoch()) % 1000;
    std::time_t t = system_clock::to_time_t(now);
    std::tm tm_buf{};
    localtime_r(&t, &tm_buf);

    char buf[64];
    std::snprintf(buf, sizeof(buf), "%04d-%02d-%02d %02d:%02d:%02d.%03d",
                  tm_buf.tm_year + 1900, tm_buf.tm_mon + 1, tm_buf.tm_mday,
                  tm_buf.tm_hour, tm_buf.tm_min, tm_buf.tm_sec,
                  static_cast<int>(ms.count()));
    return buf;
}
} // namespace

void set_min_level(Level level) { g_min_level.store(level); }

void set_min_level_from_string(const std::string& text) {
    std::string upper = text;
    std::transform(upper.begin(), upper.end(), upper.begin(),
                    [](unsigned char c) { return std::toupper(c); });
    if (upper == "DEBUG") set_min_level(Level::Debug);
    else if (upper == "INFO") set_min_level(Level::Info);
    else if (upper == "WARN") set_min_level(Level::Warn);
    else if (upper == "ERROR") set_min_level(Level::Error);
    else warn("Unknown LOG_LEVEL '" + text + "', keeping current level");
}

void write(Level level, const std::string& msg) {
    if (level < g_min_level.load()) return;

    std::ostream& out = (level == Level::Warn || level == Level::Error) ? std::cerr : std::cout;
    std::lock_guard<std::mutex> lock(g_write_mtx);
    out << "[" << timestamp() << "] [" << level_name(level) << "] " << msg << "\n";
}

} // namespace threadlink::log
