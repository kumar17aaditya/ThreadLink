# Compiler and flags
CXX = g++
CXXFLAGS = -std=c++17 -pthread -Wall -Iinclude
LDFLAGS = -pthread

# Source files
SERVER_SRC = src/main.cpp src/Server.cpp
CLIENT_SRC = client.cpp

# Object files (auto-generated from source files)
SERVER_OBJ = $(SERVER_SRC:.cpp=.o)
CLIENT_OBJ = $(CLIENT_SRC:.cpp=.o)

# Executable names
SERVER_EXE = server
CLIENT_EXE = client

# Default target: build all
all: $(SERVER_EXE) $(CLIENT_EXE)

# Rule to build the server
$(SERVER_EXE): $(SERVER_OBJ)
	$(CXX) $(CXXFLAGS) -o $@ $^ $(LDFLAGS)

# Rule to build the client
$(CLIENT_EXE): $(CLIENT_OBJ)
	$(CXX) $(CXXFLAGS) -o $@ $^ $(LDFLAGS)

# Generic rule to compile .cpp files into .o object files
%.o: %.cpp
	$(CXX) $(CXXFLAGS) -c -o $@ $<

# Clean up build files
clean:
	rm -f $(SERVER_EXE) $(CLIENT_EXE) $(SERVER_OBJ) $(CLIENT_OBJ)

# Phony targets
.PHONY: all clean