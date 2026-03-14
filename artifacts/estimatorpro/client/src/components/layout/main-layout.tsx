import { useState, useEffect } from "react";
import Sidebar from "./sidebar";
import BottomNavigation from "./bottom-navigation.tsx";

interface MainLayoutProps {
  children: React.ReactNode;
}

export default function MainLayout({ children }: MainLayoutProps) {
  const [isIphone, setIsIphone] = useState(false);
  const [_isIpad, setIsIpad] = useState(false);

  useEffect(() => {
    const checkDevice = () => {
      const isIpadDevice = /iPad/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const isIphoneDevice = /iPhone|iPod/.test(navigator.userAgent);
      setIsIpad(isIpadDevice);
      setIsIphone(isIphoneDevice);
    };
    checkDevice();
    window.addEventListener('resize', checkDevice);
    return () => window.removeEventListener('resize', checkDevice);
  }, []);

  if (isIphone) {
    // iPhone: Content takes full height with bottom navigation and safe areas
    return (
      <div 
        className="flex flex-col h-screen w-full"
        style={{
          paddingTop: 'max(20px, env(safe-area-inset-top))',
          paddingLeft: 'max(8px, env(safe-area-inset-left))',
          paddingRight: 'max(8px, env(safe-area-inset-right))',
          minHeight: '100dvh'
        }}
      >
        <main 
          className="flex-1 overflow-auto w-full" 
          style={{
            paddingBottom: `calc(80px + max(8px, env(safe-area-inset-bottom)))`,
            WebkitOverflowScrolling: 'touch'
          }}
        >
          {children}
        </main>
        <BottomNavigation />
      </div>
    );
  }

  // iPad and Desktop: Traditional sidebar layout
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
