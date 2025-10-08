/**
 * OmegleClone Signaling Server
 * 
 * This server handles:
 * 1. WebRTC signaling (SDP offers/answers and ICE candidates)
 * 2. Matchmaking logic (pairing random users)
 * 3. User queue management
 */

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Enable CORS for frontend connection
app.use(cors());
app.use(express.json());

// Socket.io with CORS configuration
const io = socketIo(server, {
  cors: {
    origin: "*", // In production, replace with your frontend URL
    methods: ["GET", "POST"]
  }
});

// ============================================
// MATCHMAKING QUEUE
// ============================================
let waitingQueue = []; // Users waiting to be paired
let activePairs = new Map(); // Map of socketId -> partnerId

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Pair two users from the waiting queue
 */
function pairUsers() {
  while (waitingQueue.length >= 2) {
    const user1 = waitingQueue.shift();
    const user2 = waitingQueue.shift();
    
    // Store the pairing
    activePairs.set(user1.id, user2.id);
    activePairs.set(user2.id, user1.id);
    
    // Notify both users they've been paired
    user1.emit('paired', { partnerId: user2.id });
    user2.emit('paired', { partnerId: user1.id });
    
    console.log(`✅ Paired: ${user1.id} <-> ${user2.id}`);
  }
}

/**
 * Remove user from queue or active pair
 */
function removeUser(socketId) {
  // Remove from waiting queue
  waitingQueue = waitingQueue.filter(user => user.id !== socketId);
  
  // Check if user was in an active pair
  if (activePairs.has(socketId)) {
    const partnerId = activePairs.get(socketId);
    
    // Notify partner about disconnection
    const partnerSocket = io.sockets.sockets.get(partnerId);
    if (partnerSocket) {
      partnerSocket.emit('partner-disconnected');
    }
    
    // Remove both from active pairs
    activePairs.delete(socketId);
    activePairs.delete(partnerId);
    
    console.log(`🔌 User ${socketId} disconnected from ${partnerId}`);
  }
}

// ============================================
// SOCKET.IO EVENT HANDLERS
// ============================================

io.on('connection', (socket) => {
  console.log(`🟢 User connected: ${socket.id}`);
  
  // ----------------
  // START MATCHMAKING
  // ----------------
  socket.on('start-search', () => {
    console.log(`🔍 User ${socket.id} started searching...`);
    
    // Remove from any existing queue/pair first
    removeUser(socket.id);
    
    // Add to waiting queue
    waitingQueue.push(socket);
    socket.emit('searching');
    
    // Try to pair users
    pairUsers();
  });
  
  // ----------------
  // WEBRTC SIGNALING
  // ----------------
  
  // Relay SDP offer to partner
  socket.on('offer', (data) => {
    const partnerId = activePairs.get(socket.id);
    if (partnerId) {
      io.to(partnerId).emit('offer', {
        offer: data.offer,
        from: socket.id
      });
      console.log(`📤 Offer sent from ${socket.id} to ${partnerId}`);
    }
  });
  
  // Relay SDP answer to partner
  socket.on('answer', (data) => {
    const partnerId = activePairs.get(socket.id);
    if (partnerId) {
      io.to(partnerId).emit('answer', {
        answer: data.answer,
        from: socket.id
      });
      console.log(`📥 Answer sent from ${socket.id} to ${partnerId}`);
    }
  });
  
  // Relay ICE candidate to partner
  socket.on('ice-candidate', (data) => {
    const partnerId = activePairs.get(socket.id);
    if (partnerId) {
      io.to(partnerId).emit('ice-candidate', {
        candidate: data.candidate,
        from: socket.id
      });
      console.log(`🧊 ICE candidate sent from ${socket.id} to ${partnerId}`);
    }
  });
  
  // ----------------
  // TEXT CHAT (via Socket.io as backup)
  // ----------------
  socket.on('chat-message', (data) => {
    const partnerId = activePairs.get(socket.id);
    if (partnerId) {
      io.to(partnerId).emit('chat-message', {
        message: data.message,
        from: 'Stranger',
        timestamp: Date.now()
      });
    }
  });
  
  // ----------------
  // NEXT / DISCONNECT
  // ----------------
  socket.on('next', () => {
    console.log(`⏭️ User ${socket.id} clicked Next`);
    removeUser(socket.id);
    
    // Start searching again
    waitingQueue.push(socket);
    socket.emit('searching');
    pairUsers();
  });
  
  socket.on('stop-search', () => {
    console.log(`⏸️ User ${socket.id} stopped searching`);
    removeUser(socket.id);
  });
  
  // ----------------
  // DISCONNECTION
  // ----------------
  socket.on('disconnect', () => {
    console.log(`🔴 User disconnected: ${socket.id}`);
    removeUser(socket.id);
  });
});

// ============================================
// HTTP ROUTES
// ============================================

// Health check endpoint
app.get('/status', (req, res) => {
  res.json({
    status: 'online',
    users: {
      waiting: waitingQueue.length,
      active: activePairs.size / 2
    },
    timestamp: new Date().toISOString()
  });
});

app.get('/', (req, res) => {
  res.send('OmegleClone Signaling Server is running! 🚀');
});

// ============================================
// START SERVER
// ============================================

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════╗
  ║  🎥 OmegleClone Signaling Server     ║
  ║  ✅ Server running on port ${PORT}      ║
  ║  📡 Socket.io ready for connections   ║
  ╚═══════════════════════════════════════╝
  `);
});

