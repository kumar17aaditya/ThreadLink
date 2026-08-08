# Compiler and flags
CXX = g++
CXXSTD = -std=c++17
WARNFLAGS = -Wall -Wextra
CXXFLAGS = $(CXXSTD) $(WARNFLAGS) -pthread -Iinclude
LDFLAGS = -pthread

# Build-type-specific flags. `make` / `make release` optimize; `make debug`
# adds symbols and sanitizers for local debugging.
RELEASE_FLAGS = -O2 -DNDEBUG
DEBUG_FLAGS = -O0 -g -fsanitize=address,undefined

# Shared protocol/network layer used by both server and client
COMMON_SRC = src/Protocol.cpp
SERVER_SRC = src/main.cpp src/Server.cpp src/Config.cpp src/Log.cpp $(COMMON_SRC)
CLIENT_SRC = client.cpp $(COMMON_SRC)

SERVER_OBJ = $(SERVER_SRC:.cpp=.o)
CLIENT_OBJ = $(CLIENT_SRC:.cpp=.o)

SERVER_EXE = server
CLIENT_EXE = client

# Default target: optimized release build
all: CXXFLAGS += $(RELEASE_FLAGS)
all: $(SERVER_EXE) $(CLIENT_EXE)

release: CXXFLAGS += $(RELEASE_FLAGS)
release: clean $(SERVER_EXE) $(CLIENT_EXE)

debug: CXXFLAGS += $(DEBUG_FLAGS)
debug: LDFLAGS += -fsanitize=address,undefined
debug: clean $(SERVER_EXE) $(CLIENT_EXE)

$(SERVER_EXE): $(SERVER_OBJ)
	$(CXX) $(CXXFLAGS) -o $@ $^ $(LDFLAGS)

$(CLIENT_EXE): $(CLIENT_OBJ)
	$(CXX) $(CXXFLAGS) -o $@ $^ $(LDFLAGS)

%.o: %.cpp
	$(CXX) $(CXXFLAGS) -c -o $@ $<

clean:
	rm -f $(SERVER_EXE) $(CLIENT_EXE) $(SERVER_OBJ) $(CLIENT_OBJ)

.PHONY: all clean debug release
