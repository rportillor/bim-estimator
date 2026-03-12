import { Server as HTTPServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { authenticateSocketToken, generateToken } from "./auth";
import { AIProcessor } from "./ai-processor";
import { storage } from "./storage";

export function setupWebSocket(server: HTTPServer): SocketIOServer {
  const io = new SocketIOServer(server, {
    cors: {
      origin: process.env.NODE_ENV === "development" ? "http://localhost:5000" : false,
      methods: ["GET", "POST"]
    }
  });

  // Initialize AI processor with WebSocket server
  const aiProcessor = new AIProcessor(io);

  // Authentication middleware for socket connections
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error("Authentication token required"));
      }

      const user = await authenticateSocketToken(token);
      if (!user) {
        return next(new Error("Invalid authentication token"));
      }

      socket.userId = user.id;
      socket.user = user;
      next();
    } catch (error) {
      next(new Error("Authentication failed"));
    }
  });

  io.on("connection", (socket) => {
    console.log(`User ${socket.user?.name} connected via WebSocket`);

    // Join user-specific room for personalized updates
    socket.join(`user:${socket.userId}`);

    // Handle AI processing requests
    socket.on("ai:start-processing", async (data) => {
      try {
        const { documentId, configId, projectId } = data;
        
        if (!projectId) {
          socket.emit("ai:error", { message: "Project ID required for comprehensive analysis" });
          return;
        }

        // 🚀 NEW: Start comprehensive analysis instead of individual document processing
        console.log(`🚀 WebSocket: Starting comprehensive analysis for project ${projectId}`);
        
        // Trigger comprehensive analysis via HTTP request to our own API
        // SECURITY: Use the authenticated user's actual token for internal requests
        const user = socket.user ? await storage.getUser(socket.user.id) : null;
        const internalToken = user ? generateToken(user) : '';
        const response = await fetch(`http://localhost:5000/api/comprehensive-analysis/${projectId}`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${internalToken}` }
        });
        
        if (response.ok) {
          const result = await response.json();
          socket.emit("ai:processing-started", { 
            projectId,
            message: "Comprehensive analysis started for entire project",
            elementsFound: result.results?.elementsExtracted || 0
          });
        } else {
          throw new Error('Comprehensive analysis failed');
        }
        
      } catch (error) {
        console.error("AI processing start error:", error);
        socket.emit("ai:error", { message: "Failed to start AI processing" });
      }
    });

    // Handle processing cancellation
    socket.on("ai:cancel-processing", async (data) => {
      try {
        const { jobId } = data;
        const cancelled = await aiProcessor.cancelJob(jobId);
        
        if (cancelled) {
          socket.emit("ai:processing-cancelled", { jobId, message: "Processing cancelled" });
        } else {
          socket.emit("ai:error", { message: "Job not found or already completed" });
        }
      } catch (error) {
        console.error("AI processing cancellation error:", error);
        socket.emit("ai:error", { message: "Failed to cancel processing" });
      }
    });

    // Handle real-time configuration updates
    socket.on("ai:update-config", (data) => {
      // Broadcast configuration updates to relevant users
      socket.to(`project:${data.projectId}`).emit("ai:config-updated", data);
    });

    // Join project-specific rooms for project updates
    socket.on("join-project", (projectId) => {
      socket.join(`project:${projectId}`);
      console.log(`User ${socket.user?.name} joined project ${projectId}`);
    });

    // Leave project-specific rooms
    socket.on("leave-project", (projectId) => {
      socket.leave(`project:${projectId}`);
      console.log(`User ${socket.user?.name} left project ${projectId}`);
    });

    // Handle real-time document analysis requests
    socket.on("document:request-analysis", (data) => {
      const { documentId, analysisType } = data;
      
      // Emit to all users in the project
      socket.to(`project:${data.projectId}`).emit("document:analysis-requested", {
        documentId,
        analysisType,
        requestedBy: socket.user?.name,
        timestamp: new Date().toISOString()
      });
    });

    // Handle disconnection
    socket.on("disconnect", (reason) => {
      console.log(`User ${socket.user?.name} disconnected: ${reason}`);
    });

    // Handle errors
    socket.on("error", (error) => {
      console.error("Socket error:", error);
    });
  });

  // Global room for system-wide announcements
  io.emit("system:connected", { 
    message: "EstimatorPro WebSocket server is running",
    timestamp: new Date().toISOString(),
    features: [
      "Real-time AI processing updates",
      "Live collaboration",
      "Instant notifications",
      "Progress tracking"
    ]
  });

  return io;
}

// Extend socket interface for TypeScript
declare module "socket.io" {
  interface Socket {
    userId?: string;
    user?: any;
  }
}