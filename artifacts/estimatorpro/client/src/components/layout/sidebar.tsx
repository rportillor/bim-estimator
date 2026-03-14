import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { 
  LayoutDashboard, 
  FolderOpen, 
  Upload, 
  FileText,
  Table, 
  Box, 
  Shield, 
  FolderOutput,
  DraftingCompass,
  Calculator,
  BarChart3,
  LogOut,
  User,
  Settings
} from "lucide-react";

const sections = [
  {
    label: null,
    items: [
      { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { name: "Projects", href: "/projects", icon: FolderOpen },
    ],
  },
  {
    label: "Documents",
    items: [
      { name: "Upload Documents", href: "/upload", icon: Upload },
      { name: "All Documents", href: "/documents", icon: FileText },
    ],
  },
  {
    label: "BIM",
    items: [
      { name: "3D BIM Viewer", href: "/bim", icon: Box },
      { name: "BIM Coordination", href: "/coordination", icon: DraftingCompass },
    ],
  },
  {
    label: "Estimate",
    items: [
      { name: "Bill of Quantities", href: "/boq", icon: Table },
      { name: "Estimator (QS L5)", href: "/estimator", icon: Calculator },
      { name: "Benchmark", href: "/benchmark", icon: BarChart3 },
      { name: "Compliance Check", href: "/compliance", icon: Shield },
      { name: "Reports & Export", href: "/reports", icon: FolderOutput },
    ],
  },
];

export default function Sidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  const getUserInitials = (name: string) =>
    name.split(' ').map(n => n[0]).join('').toUpperCase();

  return (
    <aside className="w-64 bg-white shadow-lg flex flex-col">
      <div className="p-6 border-b">
        <h1 className="text-2xl font-bold text-primary flex items-center">
          <DraftingCompass className="mr-3 h-6 w-6" />
          ConstructAI
        </h1>
        <p className="text-sm text-gray-600 mt-1">Construction Estimator</p>
      </div>

      <nav className="flex-1 p-4 overflow-y-auto">
        <ul className="space-y-1">
          {sections.map((section, si) => (
            <li key={si}>
              {section.label && (
                <p className={cn(
                  "text-xs font-semibold uppercase tracking-wider text-gray-400 px-3 pb-1",
                  si > 0 && "pt-4"
                )}>
                  {section.label}
                </p>
              )}
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = location === item.href || (item.href === "/dashboard" && location === "/");
                  return (
                    <li key={item.name}>
                      <Link
                        href={item.href}
                        data-testid={`nav-link-${item.name.toLowerCase().replace(/\s+/g, '-')}`}
                        className={cn(
                          "flex items-center p-3 rounded-lg text-gray-700 hover:bg-gray-100 transition-colors text-sm",
                          isActive && "bg-primary text-white hover:bg-primary"
                        )}
                      >
                        <Icon className="mr-3 h-4 w-4 shrink-0" />
                        {item.name}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </nav>

      <div className="p-4 border-t">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="w-full justify-start h-auto p-2">
              <div className="flex items-center w-full">
                <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center text-white text-sm font-semibold">
                  {user ? getUserInitials(user.name) : 'U'}
                </div>
                <div className="ml-3 text-left">
                  <p className="text-sm font-medium">{user?.name || 'User'}</p>
                  <p className="text-xs text-gray-500">{user?.role || 'Role'}</p>
                </div>
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem asChild>
              <Link href="/profile" data-testid="dropdown-profile-link">
                <User className="mr-2 h-4 w-4" />
                <span>Profile</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings" data-testid="dropdown-settings-link">
                <Settings className="mr-2 h-4 w-4" />
                <span>Settings</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout} className="text-red-600">
              <LogOut className="mr-2 h-4 w-4" />
              <span>Sign out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}
