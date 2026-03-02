import React, { useState, useEffect, useRef } from 'react';
import { updateProfile, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth';
import { useAuthLogic } from '../../auth/hooks/useAuthLogic';
import { useDashboard } from '../../../contexts/DashboardContext';
import { useNotification } from '../../../contexts/NotificationContext';
import { uploadDashboardAvatar, updateUserRoleProfile } from '../../../services/firebaseService';
import { saveImageToDB, getImageFromDB } from '../../../utils/indexedDB'; // Keep for cache/fallback if needed
import Spinner from '../../../components/ui/Spinner';
import { User as UserIcon, Camera, Save, Sparkles, Mail, Link as LinkIcon, ShieldCheck, Upload, Info, LockKeyhole, X, KeyRound, BadgeCheck, ArrowLeft, ChevronRight, AlertCircle, Globe, Laptop, Clock, Monitor } from 'lucide-react';

const UserProfileSettings: React.FC = () => {
    const { user, userProfile } = useAuthLogic();
    const { addNotification } = useNotification();
    const { refreshBoards } = useDashboard(); // Add refreshBoards

    // Local state
    const [displayName, setDisplayName] = useState(user?.displayName || '');
    const [photoURL, setPhotoURL] = useState(user?.photoURL || '');
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [activeField, setActiveField] = useState<string | null>(null);
    const [showBadgeRules, setShowBadgeRules] = useState(false);

    // View Mode State: 'profile' or 'security'
    const [viewMode, setViewMode] = useState<'profile' | 'security'>('profile');

    // Password Change State
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [passwordLoading, setPasswordLoading] = useState(false);

    // Handle click outside to close tooltip
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (tooltipRef.current && !tooltipRef.current.contains(event.target as Node)) {
                setShowBadgeRules(false);
            }
        };

        if (showBadgeRules) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [showBadgeRules]);

    const [ipAddress, setIpAddress] = useState<string>('Loading...');

    // Detect Browser & OS
    const browserInfo = React.useMemo(() => {
        const ua = navigator.userAgent;
        if (ua.includes("Edg/")) return "Microsoft Edge";
        if (ua.includes("Chrome/")) return "Google Chrome";
        if (ua.includes("Firefox/")) return "Mozilla Firefox";
        if (ua.includes("Safari/")) return "Apple Safari";
        return "Unknown Browser";
    }, []);

    const osInfo = React.useMemo(() => {
        const ua = navigator.userAgent;
        if (ua.includes("Win")) return "Windows";
        if (ua.includes("Mac")) return "macOS";
        if (ua.includes("Linux")) return "Linux";
        if (ua.includes("Android")) return "Android";
        if (ua.includes("iOS")) return "iOS";
        return "Unknown OS";
    }, []);

    // Fetch IP
    useEffect(() => {
        fetch('https://api.ipify.org?format=json')
            .then(res => res.json())
            .then(data => setIpAddress(data.ip))
            .catch(() => setIpAddress('Unavailable'));
    }, []);

    // Sync state with user prop
    useEffect(() => {
        if (user) {
            setDisplayName(user.displayName || '');
            setPhotoURL(user.photoURL || '');

            // Check for local avatar override
            getImageFromDB(user.uid).then((blob) => {
                if (blob) {
                    const localUrl = URL.createObjectURL(blob);
                    setPhotoURL(localUrl);
                }
            }).catch(console.error);
        }
    }, [user]);

    const handleSaveProfile = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;

        setIsLoading(true);
        try {
            let finalPhotoURL = photoURL;

            // 1. Upload Avatar if selected
            if (selectedFile) {
                // Upload to "avatars_dashboard/{uid}" (overwrite)
                const url = await uploadDashboardAvatar(selectedFile, user.uid);
                finalPhotoURL = url;

                // Also update local view immediately just in case
                setPhotoURL(url);

                // Optional: Save to IndexedDB for offline cache matching Sidebar
                saveImageToDB(user.uid, selectedFile).catch(console.error);
            }

            const cleanDisplayName = displayName.trim();
            const cleanPhotoURL = finalPhotoURL?.trim() || null;

            // 2. Update Firestore (User Role) - PRIMARY SOURCE
            await updateUserRoleProfile(user.uid, {
                displayName: cleanDisplayName,
                photoURL: cleanPhotoURL || ''
            });

            // 3. Update Firebase Auth Profile (Sync)
            await updateProfile(user, {
                displayName: cleanDisplayName,
                photoURL: cleanPhotoURL
            });

            // Trigger global refresh for sidebar boards
            await refreshBoards();

            addNotification('Profile updated successfully!', 'success');

            // Clear file selection
            setSelectedFile(null);

        } catch (error: any) {
            console.error("Error updating profile:", error);
            addNotification(`Failed to update profile: ${error.message} `, 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const handleUpdatePassword = async () => {
        if (!currentPassword) {
            addNotification('Please enter your current password.', 'error');
            return;
        }
        if (!newPassword) {
            addNotification('Please enter a new password.', 'error');
            return;
        }
        if (newPassword.length < 6) {
            addNotification('Password must be at least 6 characters.', 'error');
            return;
        }
        if (newPassword !== confirmPassword) {
            addNotification('Passwords do not match.', 'error');
            return;
        }
        if (!user || !user.email) return;

        setPasswordLoading(true);
        try {
            // 1. Re-authenticate
            const credential = EmailAuthProvider.credential(user.email, currentPassword);
            await reauthenticateWithCredential(user, credential);

            // 2. Update Password
            await updatePassword(user, newPassword);

            addNotification('Password updated successfully!', 'success');

            // Return to profile
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
            setViewMode('profile');

        } catch (error: any) {
            console.error("Error updating password:", error);
            if (error.code === 'auth/wrong-password') {
                addNotification('Incorrect current password.', 'error');
            } else if (error.code === 'auth/requires-recent-login') {
                addNotification('Security check needed: Please logout and login again.', 'error');
            } else {
                addNotification(`Failed to update password: ${error.message}`, 'error');
            }
        } finally {
            setPasswordLoading(false);
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !user) return;

        // Basic validation
        if (!file.type.startsWith('image/')) {
            addNotification('Please select an image file.', 'error');
            return;
        }
        if (file.size > 5 * 1024 * 1024) { // 5MB limit
            addNotification('Image size should be less than 5MB.', 'error');
            return;
        }

        // Set file for upload
        setSelectedFile(file);

        // Create local preview
        const localUrl = URL.createObjectURL(file);
        setPhotoURL(localUrl);
    };

    // Derived initials
    const initials = displayName
        ? displayName.charAt(0).toUpperCase()
        : (user?.email?.charAt(0).toUpperCase() || 'U');

    // Badge Logic
    const getRoleBadge = () => {
        if (userProfile?.role === 'owner') {
            return { label: 'OWNER', color: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400', icon: <ShieldCheck className="w-3 h-3" /> };
        }
        if (userProfile?.permissions?.canManageSettings) {
            return { label: 'MANAGER', color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400', icon: <Sparkles className="w-3 h-3" /> };
        }
        return { label: 'STAFF', color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400', icon: <UserIcon className="w-3 h-3" /> };
    };

    const badge = getRoleBadge();

    return (
        <div className="h-full flex flex-col md:flex-row gap-4 p-1 overflow-y-auto md:overflow-hidden scrollbar-hide">

            {/* Left Column: Visual Identity - COMPACT */}
            <div className="w-full md:w-[30%] flex flex-col gap-3 relative z-20">
                {/* Main Avatar Card */}
                <div className="relative rounded-xl shadow-md group h-full md:max-h-[380px] bg-white dark:bg-gray-800">
                    {/* Background */}
                    <div className="absolute inset-0 rounded-xl overflow-hidden border border-gray-100 dark:border-gray-700 bg-gradient-to-br from-white to-gray-50 dark:from-gray-800 dark:to-gray-900">
                        <div className="absolute top-0 left-0 w-full h-20 bg-gradient-to-r from-blue-500/10 to-purple-500/10 dark:from-blue-500/20 dark:to-purple-500/20"></div>
                    </div>

                    {/* Content */}
                    <div className="relative z-10 p-4 flex flex-col items-center text-center h-full justify-center">
                        <div className="relative mb-3 z-10 group/avatar">
                            <div className="w-24 h-24 rounded-full p-1 bg-gradient-to-tr from-blue-500 via-purple-500 to-pink-500 shadow-lg cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                                <div className="w-full h-full rounded-full bg-white dark:bg-gray-900 p-1 overflow-hidden relative">
                                    {isUploading ? (
                                        <div className="w-full h-full flex items-center justify-center bg-gray-100 dark:bg-gray-800">
                                            <Spinner size="sm" />
                                        </div>
                                    ) : photoURL ? (
                                        <img
                                            src={photoURL}
                                            alt="Avatar"
                                            className="w-full h-full rounded-full object-cover group-hover/avatar:opacity-75 transition-opacity"
                                            onError={(e) => {
                                                (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${displayName || 'User'}&background=random`;
                                            }}
                                        />
                                    ) : (
                                        <div className="w-full h-full rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-br from-blue-600 to-purple-600 group-hover/avatar:opacity-75 transition-opacity">
                                            {initials}
                                        </div>
                                    )}
                                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition-opacity">
                                        <Camera className="w-6 h-6 text-white drop-shadow-md" />
                                    </div>
                                </div>
                            </div>
                            <div className="absolute bottom-1 right-1 bg-green-500 w-4 h-4 rounded-full border-2 border-white dark:border-gray-900 shadow-sm" title="Online"></div>

                            <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileChange} />
                        </div>

                        <h3 className="relative text-lg font-bold text-gray-900 dark:text-white z-10 leading-tight">{displayName || 'Anonymous'}</h3>
                        <p className="relative text-xs text-gray-500 dark:text-gray-400 mb-3 z-10">{user?.email}</p>

                        <div className="relative flex gap-1.5 z-10 items-center">
                            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 uppercase tracking-wider shadow-sm ${badge.color}`}>
                                {badge.icon} {badge.label}
                            </span>
                            <div className="relative flex items-center">
                                <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); setShowBadgeRules(!showBadgeRules); }}
                                    className="text-gray-400 hover:text-blue-500 transition-colors p-1"
                                >
                                    <Info className="w-3.5 h-3.5" />
                                </button>
                                {showBadgeRules && (
                                    <div ref={tooltipRef} className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-72 bg-white/95 dark:bg-gray-800/95 backdrop-blur-xl p-4 rounded-xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.3)] border border-gray-100 dark:border-gray-600 ring-1 ring-black/5 z-50 text-left animate-in fade-in zoom-in-95 duration-200">
                                        {/* Tooltip Content same as before */}
                                        <div className="absolute -top-2 left-1/2 -translate-x-1/2 border-8 border-transparent border-b-white/95 dark:border-b-gray-800/95 drop-shadow-sm"></div>
                                        <h5 className="text-xs font-bold text-gray-900 dark:text-gray-100 mb-2 border-b border-gray-100 dark:border-gray-700 pb-2">Your Permissions</h5>
                                        <div className="space-y-2">
                                            <p className="text-[10px] text-gray-500 dark:text-gray-400">
                                                {userProfile?.role === 'owner' ? 'Full System Control' : 'Standard Staff Access'}
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>



                {/* Session Info Card */}
                <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-100 dark:border-gray-700 shadow-sm flex flex-col gap-3">
                    <h4 className="text-xs font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2 border-b border-gray-100 dark:border-gray-700 pb-2">
                        <Monitor className="w-3.5 h-3.5 text-blue-500" /> Session Info
                    </h4>

                    <div className="space-y-3">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center text-blue-600 dark:text-blue-400">
                                <Laptop className="w-4 h-4" />
                            </div>
                            <div>
                                <p className="text-[10px] text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider">Device</p>
                                <p className="text-xs font-semibold text-gray-900 dark:text-gray-200">{browserInfo} on {osInfo}</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                                <Globe className="w-4 h-4" />
                            </div>
                            <div>
                                <p className="text-[10px] text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider">IP Address</p>
                                <p className="text-xs font-semibold text-gray-900 dark:text-gray-200 font-mono">{ipAddress}</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center text-blue-600 dark:text-blue-400">
                                <Clock className="w-4 h-4" />
                            </div>
                            <div>
                                <p className="text-[10px] text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider">Last Login</p>
                                <p className="text-xs font-semibold text-gray-900 dark:text-gray-200 truncate max-w-[150px]" title={user?.metadata.lastSignInTime}>
                                    {user?.metadata.lastSignInTime ? new Date(user.metadata.lastSignInTime).toLocaleString() : 'N/A'}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Right Column: Dynamic View - COMPACT */}
            <div className="flex-1 bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700 relative flex flex-col">
                <div className="absolute top-0 right-0 p-4 pointer-events-none opacity-5 overflow-hidden">
                    <UserIcon className="w-24 h-24 text-gray-500" />
                </div>

                {/* --- VIEW: PROFILE SETTINGS --- */}
                {viewMode === 'profile' && (
                    <div className="relative z-10 animate-in fade-in slide-in-from-right-4 duration-300 h-full flex flex-col">
                        <div className="mb-4">
                            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Profile Settings</h2>
                        </div>

                        <form onSubmit={handleSaveProfile} className="space-y-5 flex-1 flex flex-col">
                            <h3 className="text-xs font-bold text-gray-900 dark:text-gray-100 mb-2 flex items-center gap-2 border-b border-gray-100 dark:border-gray-700 pb-1">
                                <BadgeCheck className="w-3.5 h-3.5 text-blue-500" /> Personal Details
                            </h3>

                            <div className="group">
                                <label className="block text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                                    Display Name
                                </label>
                                <div className={`relative flex items-center bg-gray-50 dark:bg-gray-900/50 border rounded-lg overflow-hidden transition-all duration-300 ${activeField === 'name' ? 'border-blue-500 ring-2 ring-blue-500/10' : 'border-gray-200 dark:border-gray-700'}`}>
                                    <div className="pl-3 text-gray-400"> <UserIcon className="w-4 h-4" /> </div>
                                    <input
                                        type="text"
                                        value={displayName}
                                        onChange={(e) => setDisplayName(e.target.value)}
                                        onFocus={() => setActiveField('name')}
                                        onBlur={() => setActiveField(null)}
                                        placeholder="Full Name"
                                        className="w-full bg-transparent px-3 py-2 outline-none text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400"
                                    />
                                </div>
                            </div>

                            <div className="group">
                                <label className="block text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                                    Avatar URL
                                </label>
                                <div className={`relative flex items-center bg-gray-50 dark:bg-gray-900/50 border rounded-lg overflow-hidden transition-all duration-300 ${activeField === 'avatar' ? 'border-purple-500 ring-2 ring-purple-500/10' : 'border-gray-200 dark:border-gray-700'}`}>
                                    <div className="pl-3 text-gray-400"> <LinkIcon className="w-4 h-4" /> </div>
                                    <input
                                        type="text"
                                        value={photoURL}
                                        onChange={(e) => setPhotoURL(e.target.value)}
                                        onFocus={() => setActiveField('avatar')}
                                        onBlur={() => setActiveField(null)}
                                        placeholder="url image..."
                                        className="w-full bg-transparent px-3 py-2 outline-none text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400"
                                    />
                                    <button type="button" onClick={() => fileInputRef.current?.click()} className="p-1.5 mr-1 text-gray-500 hover:text-purple-600 rounded">
                                        <Upload className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>

                            <div className="group">
                                <label className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-2">
                                    Email <span className="text-[9px] bg-gray-100 dark:bg-gray-700 px-1.5 rounded text-gray-500">READ ONLY</span>
                                </label>
                                <div className="relative flex items-center bg-gray-100 dark:bg-gray-900/50 border border-dashed border-gray-200 dark:border-gray-700 rounded-lg cursor-not-allowed opacity-80">
                                    <div className="pl-3 text-gray-400"> <Mail className="w-4 h-4" /> </div>
                                    <input
                                        type="text"
                                        value={user?.email || ''}
                                        disabled
                                        className="w-full bg-transparent px-3 py-2 outline-none text-sm text-gray-600 dark:text-gray-300 font-mono"
                                    />
                                    <div className="pr-3 text-[10px] font-bold text-green-600 uppercase">Verified</div>
                                </div>
                            </div>

                            <div className="pt-3 mt-2 border-t border-gray-100 dark:border-gray-700 flex-1">
                                <div className="pt-3 mt-2 border-t border-gray-100 dark:border-gray-700 flex-1">
                                    <div
                                        onClick={() => setViewMode('security')}
                                        className="group cursor-pointer bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-800/30 rounded-lg p-3 flex items-center justify-between hover:bg-blue-100 hover:border-blue-200 transition-all duration-200"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-white dark:bg-gray-800 flex items-center justify-center text-blue-500 shadow-sm">
                                                <LockKeyhole className="w-4 h-4" />
                                            </div>
                                            <div>
                                                <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100 group-hover:text-blue-600">Change Password</h4>
                                                <p className="text-[10px] text-gray-500 dark:text-gray-400">Manage password.</p>
                                            </div>
                                        </div>
                                        <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-blue-500" />
                                    </div>
                                </div>
                            </div>

                            <div className="flex justify-end pt-2 gap-2 mt-auto">
                                <button
                                    type="button"
                                    onClick={() => { setDisplayName(user?.displayName || ''); setPhotoURL(user?.photoURL || ''); }}
                                    className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                                >
                                    Reset
                                </button>
                                <button
                                    type="submit"
                                    disabled={isLoading || isUploading}
                                    className="px-6 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-bold rounded-lg shadow-md hover:shadow-lg transform active:scale-95 transition-all flex items-center gap-2"
                                >
                                    {isLoading ? <Spinner size="sm" color="text-white" /> : <Save className="w-3.5 h-3.5" />}
                                    <span>Save</span>
                                </button>
                            </div>
                        </form>
                    </div>
                )}

                {/* --- VIEW: SECURITY SETTINGS --- */}
                {viewMode === 'security' && (
                    <div className="relative z-10 animate-in fade-in slide-in-from-right-4 duration-300 h-full flex flex-col">
                        <div className="mb-4 flex items-center gap-2">
                            <button
                                onClick={() => setViewMode('profile')}
                                className="p-1.5 -ml-1.5 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-900 transition-all"
                            >
                                <ArrowLeft className="w-4 h-4" />
                            </button>
                            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Change Password</h2>
                        </div>

                        <div className="flex-1 flex flex-col justify-between">
                            <div className="bg-blue-50 dark:bg-blue-900/10 rounded-xl p-4 border border-blue-100 dark:border-blue-800/30 space-y-3">
                                <div className="group">
                                    <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Current Password</label>
                                    <div className="relative flex items-center bg-white border border-gray-200 rounded-lg overflow-hidden">
                                        <div className="pl-3 text-gray-400"> <KeyRound className="w-4 h-4" /> </div>
                                        <input
                                            type="password"
                                            value={currentPassword}
                                            onChange={(e) => setCurrentPassword(e.target.value)}
                                            placeholder="Current password"
                                            className="w-full bg-transparent px-3 py-2 outline-none text-sm"
                                        />
                                    </div>
                                </div>

                                <div className="border-t border-blue-200/50 my-1"></div>

                                <div className="space-y-4 mt-3">
                                    <div className="group">
                                        <label className="block text-[10px] font-bold text-blue-600 uppercase tracking-wider mb-1">New Password</label>
                                        <div className="relative flex items-center bg-white border border-blue-200 rounded-lg overflow-hidden focus-within:ring-2 ring-blue-100">
                                            <div className="pl-3 text-gray-400"> <LockKeyhole className="w-4 h-4" /> </div>
                                            <input
                                                type="password"
                                                value={newPassword}
                                                onChange={(e) => setNewPassword(e.target.value)}
                                                placeholder="New Password"
                                                className="w-full bg-transparent px-3 py-2 outline-none text-sm"
                                            />
                                        </div>
                                    </div>

                                    <div className="group">
                                        <label className="block text-[10px] font-bold text-blue-600 uppercase tracking-wider mb-1">Confirm</label>
                                        <div className="relative flex items-center bg-white border border-blue-200 rounded-lg overflow-hidden focus-within:ring-2 ring-blue-100">
                                            <div className="pl-3 text-gray-400"> <LockKeyhole className="w-4 h-4" /> </div>
                                            <input
                                                type="password"
                                                value={confirmPassword}
                                                onChange={(e) => setConfirmPassword(e.target.value)}
                                                placeholder="Confirm Password"
                                                className="w-full bg-transparent px-3 py-2 outline-none text-sm"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Alert */}
                            <div className="mt-3 flex gap-2 items-start p-2.5 bg-red-50 rounded-lg border border-red-100">
                                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                                <p className="text-[10px] text-red-600 leading-snug">
                                    Changing password will sign you out of other devices.
                                </p>
                            </div>

                            <div className="mt-4 flex justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => setViewMode('profile')}
                                    className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-lg"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={handleUpdatePassword}
                                    disabled={passwordLoading || !newPassword || !currentPassword}
                                    className={`
                                        flex items-center gap-2 px-6 py-2 rounded-lg font-bold text-white text-xs shadow-md transition-all transform active:scale-95
                                        ${passwordLoading || !newPassword || !currentPassword ? 'bg-blue-300' : 'bg-gradient-to-r from-blue-500 to-indigo-500 hover:shadow-blue-500/30'}
                                    `}
                                >
                                    {passwordLoading ? <Spinner size="sm" color="text-white" /> : <Save className="w-3.5 h-3.5" />}
                                    Update
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default UserProfileSettings;
