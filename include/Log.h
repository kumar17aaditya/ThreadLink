#ifndef THREADLINK_LOG_H
#define THREADLINK_LOG_H

#include <string>

namespace threadlink::log {

enum class Level { Debug, Info, Warn, Error };

// Messages below the minimum level are dropped. Default is Info.
void set_min_level(Level level);

// Parses "DEBUG"/"INFO"/"WARN"/"ERROR" (case-insensitive). Unrecognized
// values are ignored (level stays unchanged) and a warning is logged.
void set_min_level_from_string(const std::string& text);

// Thread-safe: writes a single "[timestamp] [LEVEL] message" line to
// stdout (Debug/Info) or stderr (Warn/Error).
void write(Level level, const std::string& msg);

inline void debug(const std::string& msg) { write(Level::Debug, msg); }
inline void info(const std::string& msg) { write(Level::Info, msg); }
inline void warn(const std::string& msg) { write(Level::Warn, msg); }
inline void error(const std::string& msg) { write(Level::Error, msg); }

} // namespace threadlink::log

#endif // THREADLINK_LOG_H
