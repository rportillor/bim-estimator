import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";

interface User {
  id: string;
  username: string;
  name: string;
  role: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (_user: User, _token: string) => void;
  logout: () => void;
  updateUser: (_user: User) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const isAuthenticated = !!user && !!token;

  const checkAuth = useCallback(async () => {
    const storedToken = localStorage.getItem("auth_token");
    if (!storedToken) {
      setUser(null);
      setToken(null);
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch("/api/auth/user", {
        headers: { Authorization: `Bearer ${storedToken}` },
      });

      if (response.ok) {
        const data = await response.json();
        setUser(data.user ?? data);
        setToken(storedToken);
      } else {
        localStorage.removeItem("auth_token");
        setUser(null);
        setToken(null);
      }
    } catch (error) {
      console.error("Auth check failed:", error);
      localStorage.removeItem("auth_token");
      setUser(null);
      setToken(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial auth check on mount
  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // Cross-iframe/tab sync: when another frame logs in or out, pick up the change
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key !== "auth_token") return;

      if (!e.newValue) {
        // Token was removed (logout in another tab/iframe)
        setUser(null);
        setToken(null);
      } else if (e.newValue !== token) {
        // New token written (login in another tab/iframe) — re-verify it
        checkAuth();
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [token, checkAuth]);

  const login = (userData: User, userToken: string) => {
    setUser(userData);
    setToken(userToken);
    localStorage.setItem("auth_token", userToken);
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem("auth_token");
  };

  const updateUser = (userData: User) => {
    setUser(userData);
  };

  const contextValue: AuthContextType = {
    user,
    token,
    isLoading,
    isAuthenticated,
    login,
    logout,
    updateUser,
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
