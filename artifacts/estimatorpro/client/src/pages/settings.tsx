import { useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { 
  Bell,
  Shield,
  Eye,
  Palette,
  Trash2,
  AlertTriangle,
  Save
} from "lucide-react";

interface SettingsData {
  notifications: {
    email: boolean;
    push: boolean;
    projectUpdates: boolean;
    systemAlerts: boolean;
  };
  privacy: {
    profileVisibility: 'public' | 'team' | 'private';
    dataSharing: boolean;
    analytics: boolean;
  };
  preferences: {
    theme: 'light' | 'dark' | 'system';
    language: string;
    timezone: string;
    currency: string;
  };
  security: {
    twoFactorEnabled: boolean;
    sessionTimeout: number;
  };
}

export default function SettingsPage() {
  const { logout } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [hasChanges, setHasChanges] = useState(false);

  // Fetch current settings
  const { data: settings, isLoading } = useQuery({
    queryKey: ['/api/user/settings'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/user/settings');
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const [formData, setFormData] = useState<SettingsData>({
    notifications: {
      email: settings?.notifications?.email ?? true,
      push: settings?.notifications?.push ?? true,
      projectUpdates: settings?.notifications?.projectUpdates ?? true,
      systemAlerts: settings?.notifications?.systemAlerts ?? true,
    },
    privacy: {
      profileVisibility: settings?.privacy?.profileVisibility ?? 'team',
      dataSharing: settings?.privacy?.dataSharing ?? false,
      analytics: settings?.privacy?.analytics ?? true,
    },
    preferences: {
      theme: settings?.preferences?.theme ?? 'system',
      language: settings?.preferences?.language ?? 'en',
      timezone: settings?.preferences?.timezone ?? 'America/Toronto',
      currency: settings?.preferences?.currency ?? 'CAD',
    },
    security: {
      twoFactorEnabled: settings?.security?.twoFactorEnabled ?? false,
      sessionTimeout: settings?.security?.sessionTimeout ?? 60,
    }
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async (data: SettingsData) => {
      const response = await apiRequest('PUT', '/api/user/settings', data);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Settings Updated",
        description: "Your settings have been saved successfully.",
      });
      setHasChanges(false);
      queryClient.invalidateQueries({ queryKey: ['/api/user/settings'] });
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update settings.",
        variant: "destructive",
      });
    }
  });

  const deleteAccountMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('DELETE', '/api/user/account');
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Account Deleted",
        description: "Your account has been permanently deleted.",
      });
      logout();
    },
    onError: (error: any) => {
      toast({
        title: "Deletion Failed",
        description: error.message || "Failed to delete account.",
        variant: "destructive",
      });
    }
  });

  const updateSetting = (section: keyof SettingsData, key: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
        [key]: value
      }
    }));
    setHasChanges(true);
  };

  const handleSave = () => {
    updateSettingsMutation.mutate(formData);
  };

  const handleDeleteAccount = () => {
    if (window.confirm('Are you sure you want to permanently delete your account? This action cannot be undone.')) {
      deleteAccountMutation.mutate();
    }
  };

  if (isLoading) {
    return <div className="flex justify-center p-8">Loading settings...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Settings</h1>
          <p className="text-muted-foreground">
            Manage your account preferences and security settings.
          </p>
        </div>
        {hasChanges && (
          <Button 
            onClick={handleSave}
            disabled={updateSettingsMutation.isPending}
            data-testid="save-settings-button"
          >
            <Save className="h-4 w-4 mr-2" />
            {updateSettingsMutation.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Notifications */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Bell className="h-5 w-5 mr-2" />
              Notifications
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label>Email Notifications</Label>
                <p className="text-sm text-muted-foreground">Receive notifications via email</p>
              </div>
              <Switch
                checked={formData.notifications.email}
                onCheckedChange={(checked) => updateSetting('notifications', 'email', checked)}
                data-testid="switch-email-notifications"
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label>Push Notifications</Label>
                <p className="text-sm text-muted-foreground">Browser push notifications</p>
              </div>
              <Switch
                checked={formData.notifications.push}
                onCheckedChange={(checked) => updateSetting('notifications', 'push', checked)}
                data-testid="switch-push-notifications"
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label>Project Updates</Label>
                <p className="text-sm text-muted-foreground">Notifications about project changes</p>
              </div>
              <Switch
                checked={formData.notifications.projectUpdates}
                onCheckedChange={(checked) => updateSetting('notifications', 'projectUpdates', checked)}
                data-testid="switch-project-updates"
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label>System Alerts</Label>
                <p className="text-sm text-muted-foreground">Important system messages</p>
              </div>
              <Switch
                checked={formData.notifications.systemAlerts}
                onCheckedChange={(checked) => updateSetting('notifications', 'systemAlerts', checked)}
                data-testid="switch-system-alerts"
              />
            </div>
          </CardContent>
        </Card>

        {/* Privacy */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Eye className="h-5 w-5 mr-2" />
              Privacy
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Profile Visibility</Label>
              <Select
                value={formData.privacy.profileVisibility}
                onValueChange={(value: 'public' | 'team' | 'private') => 
                  updateSetting('privacy', 'profileVisibility', value)
                }
              >
                <SelectTrigger data-testid="select-profile-visibility">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">Public</SelectItem>
                  <SelectItem value="team">Team Only</SelectItem>
                  <SelectItem value="private">Private</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label>Data Sharing</Label>
                <p className="text-sm text-muted-foreground">Share anonymized usage data</p>
              </div>
              <Switch
                checked={formData.privacy.dataSharing}
                onCheckedChange={(checked) => updateSetting('privacy', 'dataSharing', checked)}
                data-testid="switch-data-sharing"
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label>Analytics</Label>
                <p className="text-sm text-muted-foreground">Help improve our service</p>
              </div>
              <Switch
                checked={formData.privacy.analytics}
                onCheckedChange={(checked) => updateSetting('privacy', 'analytics', checked)}
                data-testid="switch-analytics"
              />
            </div>
          </CardContent>
        </Card>

        {/* Preferences */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Palette className="h-5 w-5 mr-2" />
              Preferences
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Theme</Label>
              <Select
                value={formData.preferences.theme}
                onValueChange={(value: 'light' | 'dark' | 'system') => 
                  updateSetting('preferences', 'theme', value)
                }
              >
                <SelectTrigger data-testid="select-theme">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                  <SelectItem value="system">System</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Language</Label>
              <Select
                value={formData.preferences.language}
                onValueChange={(value) => updateSetting('preferences', 'language', value)}
              >
                <SelectTrigger data-testid="select-language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="fr">Français</SelectItem>
                  <SelectItem value="es">Español</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Currency</Label>
              <Select
                value={formData.preferences.currency}
                onValueChange={(value) => updateSetting('preferences', 'currency', value)}
              >
                <SelectTrigger data-testid="select-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CAD">CAD - Canadian Dollar</SelectItem>
                  <SelectItem value="USD">USD - US Dollar</SelectItem>
                  <SelectItem value="EUR">EUR - Euro</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Security */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Shield className="h-5 w-5 mr-2" />
              Security
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label>Two-Factor Authentication</Label>
                <p className="text-sm text-muted-foreground">Add extra security to your account</p>
              </div>
              <Switch
                checked={formData.security.twoFactorEnabled}
                onCheckedChange={(checked) => updateSetting('security', 'twoFactorEnabled', checked)}
                data-testid="switch-two-factor"
              />
            </div>
            <div className="space-y-2">
              <Label>Session Timeout (minutes)</Label>
              <Input
                type="number"
                value={formData.security.sessionTimeout}
                onChange={(e) => updateSetting('security', 'sessionTimeout', parseInt(e.target.value))}
                min="5"
                max="480"
                data-testid="input-session-timeout"
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Danger Zone */}
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="flex items-center text-destructive">
            <AlertTriangle className="h-5 w-5 mr-2" />
            Danger Zone
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <h3 className="font-medium">Delete Account</h3>
              <p className="text-sm text-muted-foreground">
                Permanently delete your account and all associated data. This action cannot be undone.
              </p>
            </div>
            <Button 
              variant="destructive"
              onClick={handleDeleteAccount}
              disabled={deleteAccountMutation.isPending}
              data-testid="delete-account-button"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {deleteAccountMutation.isPending ? 'Deleting...' : 'Delete Account'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}