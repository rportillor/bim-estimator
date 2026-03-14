import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import {
  LayoutDashboard,
  FolderOpen,
  Box,
  Table,
  Upload,
  FileText,
  DraftingCompass,
  Calculator,
  BarChart3,
  Shield,
  FolderOutput,
  User,
  LogOut
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

const mainNavigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard, shortName: "Home" },
  { name: "Projects",  href: "/projects",  icon: FolderOpen,      shortName: "Projects" },
  { name: "3D BIM",    href: "/bim",        icon: Box,             shortName: "BIM" },
  { name: "Estimate",  href: "/boq",        icon: Table,           shortName: "Estimate" },
];

const moreGroups = [
  {
    label: "Documents",
    items: [
      { name: "Upload Documents", href: "/upload",     icon: Upload },
      { name: "All Documents",    href: "/documents",  icon: FileText },
    ],
  },
  {
    label: "BIM",
    items: [
      { name: "BIM Coordination", href: "/coordination", icon: DraftingCompass },
    ],
  },
  {
    label: "Estimate",
    items: [
      { name: "Estimator (QS L5)", href: "/estimator", icon: Calculator },
      { name: "Benchmark",          href: "/benchmark",  icon: BarChart3 },
      { name: "Compliance Check",   href: "/compliance", icon: Shield },
      { name: "Reports & Export",   href: "/reports",    icon: FolderOutput },
    ],
  },
];

export default function BottomNavigation() {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  const getUserInitials = (name: string) =>
    name.split(' ').map(n => n[0]).join('').toUpperCase();

  return (
    <div
      className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-2 py-2 z-50 shadow-lg"
      style={{
        paddingLeft:   'max(8px, env(safe-area-inset-left))',
        paddingRight:  'max(8px, env(safe-area-inset-right))',
        paddingBottom: 'max(8px, env(safe-area-inset-bottom))',
        height: 'auto',
        minHeight: '64px',
      }}
    >
      <div className="flex items-center justify-around">
        {mainNavigation.map((item) => {
          const Icon = item.icon;
          const isActive = location === item.href || (item.href === "/dashboard" && location === "/");
          return (
            <Link
              key={item.name}
              href={item.href}
              data-testid={`bottom-nav-${item.name.toLowerCase()}`}
              className={cn(
                "flex flex-col items-center py-2 px-3 rounded-lg transition-colors min-w-0 flex-1 min-h-[44px] active:bg-gray-100",
                isActive ? "text-primary bg-blue-50" : "text-gray-600"
              )}
            >
              <Icon className={cn("h-5 w-5 mb-1", isActive && "text-primary")} />
              <span className="text-xs font-medium truncate">{item.shortName}</span>
            </Link>
          );
        })}

        {/* More dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="flex flex-col items-center py-2 px-3 rounded-lg h-auto min-w-0 flex-1 min-h-[44px] active:bg-gray-100"
            >
              <div className="grid grid-cols-2 gap-0.5 w-5 h-5 mb-1">
                <div className="w-2 h-2 bg-gray-600 rounded-sm" />
                <div className="w-2 h-2 bg-gray-600 rounded-sm" />
                <div className="w-2 h-2 bg-gray-600 rounded-sm" />
                <div className="w-2 h-2 bg-gray-600 rounded-sm" />
              </div>
              <span className="text-xs font-medium">More</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-56 mb-2">
            {moreGroups.map((group, gi) => (
              <div key={gi}>
                {gi > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel className="text-xs text-gray-400 uppercase tracking-wider">
                  {group.label}
                </DropdownMenuLabel>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = location === item.href;
                  return (
                    <DropdownMenuItem key={item.name} asChild>
                      <Link
                        href={item.href}
                        className={cn("flex items-center w-full", isActive && "bg-primary text-white")}
                      >
                        <Icon className="mr-2 h-4 w-4" />
                        <span>{item.name}</span>
                      </Link>
                    </DropdownMenuItem>
                  );
                })}
              </div>
            ))}
            <DropdownMenuSeparator />
            <div className="px-2 py-2 border-b">
              <div className="flex items-center">
                <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center text-white text-sm font-semibold">
                  {user ? getUserInitials(user.name) : 'U'}
                </div>
                <div className="ml-3 text-left">
                  <p className="text-sm font-medium">{user?.name || 'User'}</p>
                  <p className="text-xs text-gray-500">{user?.role || 'Role'}</p>
                </div>
              </div>
            </div>
            <DropdownMenuItem asChild>
              <Link href="/profile" className="flex items-center w-full">
                <User className="mr-2 h-4 w-4" />
                <span>Profile</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={logout} className="text-red-600">
              <LogOut className="mr-2 h-4 w-4" />
              <span>Sign out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
