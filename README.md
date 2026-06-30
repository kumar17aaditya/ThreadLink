# ThreadLink 🚀
### A Multi-Threaded TCP Chat System in C++

[![C++](https://img.shields.io/badge/C%2B%2B-17-blue)]()
[![Platform](https://img.shields.io/badge/Platform-Linux-green)]()
[![Build](https://img.shields.io/badge/Build-Make-orange)]()
[![License](https://img.shields.io/badge/Status-Learning%20Project-yellow)]()

ThreadLink is a multi-threaded client-server chat application built in **C++17** using **TCP/IP sockets**, **POSIX networking APIs**, and **concurrent programming techniques** on Linux.

The project demonstrates core concepts of **systems programming**, including:

- Socket Programming
- TCP/IP Networking
- Multithreading
- Synchronization using Mutexes
- Event-driven I/O using `select()`
- Client-Server Architecture
- Object-Oriented Design

---

# ✨ Features

- 🔹 Multi-threaded server (Thread-per-client architecture)
- 🔹 Real-time public messaging
- 🔹 Private one-to-one messaging
- 🔹 Dynamic nickname management
- 🔹 Online user listing
- 🔹 Graceful server shutdown
- 🔹 External configuration via `server.conf`
- 🔹 Asynchronous client using `select()`
- 🔹 Object-oriented server implementation

---

# 🏗️ Architecture

```text
                  +----------------+
                  |     Server     |
                  | (TCP Socket)   |
                  +----------------+
                   /      |      \
                  /       |       \
                 /        |        \
        +---------+ +---------+ +---------+
        | Client1 | | Client2 | | Client3 |
        +---------+ +---------+ +---------+
```

Each incoming connection spawns a dedicated thread:

```text
New Connection
      |
      v
accept()
      |
      v
Create Thread
      |
      v
handle_client()
```

---

# 🧠 Concepts Demonstrated

## Networking
- TCP/IP
- Client-Server Architecture
- Socket Programming
- Ports and File Descriptors

## Linux System Programming
- `socket()`
- `bind()`
- `listen()`
- `accept()`
- `connect()`
- `send()`
- `recv()`
- `close()`
- `select()`

## Concurrency
- `std::thread`
- `std::mutex`
- `std::lock_guard`
- Thread-per-client architecture
- Shared resource synchronization

## Object-Oriented Programming
- Encapsulation
- Modular design
- Resource management

---

# 📂 Project Structure

```text
ThreadLink/
├── include/
│   └── Server.h
├── src/
│   ├── main.cpp
│   └── Server.cpp
├── client.cpp
├── makefile
├── server.conf
├── README.md
└── .gitignore
```

---

# ⚙️ Prerequisites

- Linux
- g++ (C++17 or later)
- GNU Make

### Arch Linux

```bash
sudo pacman -S base-devel gcc
```

### Ubuntu/Debian

```bash
sudo apt install build-essential
```

---

# 🔨 Build

Clone the repository:

```bash
git clone https://github.com/kumar17aaditya/ThreadLink.git
cd ThreadLink
```

Compile:

```bash
make
```

Generated executables:

```text
server
client
```

---

# 🚀 Running the Application

### Start the server

```bash
./server
```

Expected output:

```text
Server listening on port 8080...
Type 'SHUTDOWN' to close the server.
```

---

### Start one or more clients

```bash
./client
```

---

# 💬 Commands

| Command | Description |
|---------|-------------|
| `/nick <name>` | Change nickname |
| `/msg <user> <message>` | Send private message |
| `/list` | Display connected users |
| `/exit` | Disconnect from server |

---

# ⚙️ Configuration

The server port can be changed using:

```text
server.conf
```

Example:

```text
PORT=8080
```

---

# 🖼️ Example Session

```text
Client 1:
> /nick aditya

Client 2:
> /nick shubhi

Client 1:
> Hello Everyone

Client 2:
> /msg aditya Hi Aditya!

Client 1:
(private) shubhi: Hi Aditya!
```

---

# 🛠️ Technologies Used

- C++17
- POSIX Sockets
- Linux System Programming
- Multithreading
- TCP/IP Networking
- GNU Make

---

# 📚 Learning Outcomes

Through this project, I explored:

- Low-level networking in C++
- Concurrent programming
- Socket APIs and file descriptors
- Synchronization primitives
- Event-driven I/O with `select()`
- Designing scalable client-server applications
- Building systems software on Linux

---

# 🛣️ Future Improvements

- [ ] Authentication and user registration
- [ ] Message timestamps
- [ ] Persistent chat history
- [ ] File transfer support
- [ ] Thread pool implementation
- [ ] `epoll`-based scalable I/O model
- [ ] Logging system
- [ ] End-to-end encryption

---

# 👨‍💻 Connect

- GitHub: https://github.com/kumar17aaditya
- LinkedIn: https://www.linkedin.com/in/aditya-kumar-82a292251/

---

⭐ If you found this project interesting, consider giving it a star!