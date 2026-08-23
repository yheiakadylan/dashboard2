import React, { useState, useEffect, useMemo } from 'react';
import { useDashboardAccess } from '../../../contexts/DashboardContext';
import { useNotification } from '../../../contexts/NotificationContext';
import { getPODTeams, savePODTeams } from '../../../services/firebaseService';
import { fetchOperationUsers, type OperationUser } from '../../../services/reportService';
import { PODTeam } from '../../../types';
import { Users, Plus, Edit2, Trash2, Store, Save, X, Search, CheckSquare, Square, UserRound } from 'lucide-react';
import Spinner from '../../../components/ui/Spinner';

const uniqueAccountEmails = (emails: string[]): string[] => Array.from(
  new Map(emails
    .map(email => email.trim())
    .filter(Boolean)
    .map(email => [email.toLowerCase(), email])).values(),
);

const uniqueMemberIds = (memberIds: string[]): string[] => Array.from(new Set(
  memberIds.map(uid => uid.trim()).filter(Boolean),
));

const getEmployeeLabel = (employee: OperationUser) => (
  employee.displayName || employee.fullName || employee.empID || employee.email || employee.uid
);

export const PODTeamManager: React.FC = () => {
  const { teamId, allAccounts, refreshBoards } = useDashboardAccess();
  const { addNotification } = useNotification();

  const [podTeams, setPodTeams] = useState<PODTeam[]>([]);
  const [employees, setEmployees] = useState<OperationUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Edit / Add Modal State
  const [editingTeam, setEditingTeam] = useState<PODTeam | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [accountSearch, setAccountSearch] = useState('');
  const [employeeSearch, setEmployeeSearch] = useState('');

  // Fetch POD teams
  const fetchTeams = React.useCallback(async () => {
    if (!teamId) return;
    setLoading(true);
    try {
      const [teams, operationUsers] = await Promise.all([
        getPODTeams(teamId),
        fetchOperationUsers(true),
      ]);
      setPodTeams(teams);
      setEmployees(operationUsers
        .filter(employee => employee.active !== false && employee.isActive !== false)
        .sort((left, right) => getEmployeeLabel(left).localeCompare(getEmployeeLabel(right))));
    } catch (err) {
      console.error('Failed to load POD teams', err);
      addNotification('Failed to load POD teams', 'error');
    } finally {
      setLoading(false);
    }
  }, [teamId, addNotification]);

  useEffect(() => {
    fetchTeams();
  }, [fetchTeams]);

  // Handle open add modal
  const handleAddNew = () => {
    const newId = `pod-team-${Date.now()}`;
    setEditingTeam({
      uid: newId,
      displayName: '',
      allowedAccounts: [],
      memberIds: [],
      description: '',
    });
    setAccountSearch('');
    setEmployeeSearch('');
    setIsModalOpen(true);
  };

  // Handle open edit modal
  const handleEdit = (team: PODTeam) => {
    setEditingTeam({
      ...team,
      allowedAccounts: [...team.allowedAccounts],
      memberIds: [...team.memberIds],
    });
    setAccountSearch('');
    setEmployeeSearch('');
    setIsModalOpen(true);
  };

  // Handle delete
  const handleDelete = async (uid: string) => {
    if (!teamId || !window.confirm('Are you sure you want to delete this POD Team?')) return;
    const updated = podTeams.filter(t => t.uid !== uid);
    try {
      setSaving(true);
      await savePODTeams(teamId, updated);
      setPodTeams(updated);
      await refreshBoards();
      addNotification('POD Team deleted successfully', 'success');
    } catch (err) {
      console.error('Failed to delete POD team', err);
      addNotification('Failed to delete POD team', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Save Modal Form
  const handleSaveTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTeam || !teamId) return;
    if (!editingTeam.displayName.trim()) {
      addNotification('Team name is required', 'warning');
      return;
    }

    const existingIndex = podTeams.findIndex(t => t.uid === editingTeam.uid);
    let updated: PODTeam[];

    const now = new Date().toISOString();
    const teamToSave: PODTeam = {
      ...editingTeam,
      displayName: editingTeam.displayName.trim(),
      allowedAccounts: uniqueAccountEmails(editingTeam.allowedAccounts),
      memberIds: uniqueMemberIds(editingTeam.memberIds),
      updatedAt: now,
      createdAt: editingTeam.createdAt || now,
    };

    const selectedAccountKeys = new Set(teamToSave.allowedAccounts.map(email => email.toLowerCase()));
    const selectedMemberIds = new Set(teamToSave.memberIds);
    let reassignedAccountCount = 0;
    let reassignedMemberCount = 0;

    if (existingIndex >= 0) {
      updated = podTeams.map(team => {
        if (team.uid === teamToSave.uid) return teamToSave;
        const allowedAccounts = team.allowedAccounts.filter(email => !selectedAccountKeys.has(email.toLowerCase()));
        const memberIds = team.memberIds.filter(uid => !selectedMemberIds.has(uid));
        reassignedAccountCount += team.allowedAccounts.length - allowedAccounts.length;
        reassignedMemberCount += team.memberIds.length - memberIds.length;
        return allowedAccounts.length === team.allowedAccounts.length && memberIds.length === team.memberIds.length
          ? team
          : { ...team, allowedAccounts, memberIds, updatedAt: now };
      });
    } else {
      updated = [
        ...podTeams.map(team => {
          const allowedAccounts = team.allowedAccounts.filter(email => !selectedAccountKeys.has(email.toLowerCase()));
          const memberIds = team.memberIds.filter(uid => !selectedMemberIds.has(uid));
          reassignedAccountCount += team.allowedAccounts.length - allowedAccounts.length;
          reassignedMemberCount += team.memberIds.length - memberIds.length;
          return allowedAccounts.length === team.allowedAccounts.length && memberIds.length === team.memberIds.length
            ? team
            : { ...team, allowedAccounts, memberIds, updatedAt: now };
        }),
        teamToSave,
      ];
    }

    try {
      setSaving(true);
      await savePODTeams(teamId, updated);
      setPodTeams(updated);
      setIsModalOpen(false);
      setEditingTeam(null);
      await refreshBoards();
      addNotification(
        reassignedAccountCount > 0 || reassignedMemberCount > 0
          ? `POD Team saved. Moved ${reassignedAccountCount} shop(s) and ${reassignedMemberCount} employee(s) from other PODs.`
          : 'POD Team saved successfully',
        'success',
      );
    } catch (err) {
      console.error('Failed to save POD team', err);
      addNotification('Failed to save POD team', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Toggle account in editingTeam
  const toggleAccount = (email: string) => {
    if (!editingTeam) return;
    const exists = editingTeam.allowedAccounts.includes(email);
    const updatedAccounts = exists
      ? editingTeam.allowedAccounts.filter(a => a !== email)
      : [...editingTeam.allowedAccounts, email];
    setEditingTeam({ ...editingTeam, allowedAccounts: updatedAccounts });
  };

  const toggleMember = (uid: string) => {
    if (!editingTeam) return;
    const memberIds = editingTeam.memberIds.includes(uid)
      ? editingTeam.memberIds.filter(memberId => memberId !== uid)
      : [...editingTeam.memberIds, uid];
    setEditingTeam({ ...editingTeam, memberIds });
  };

  // Select / Deselect All
  const filteredAccounts = useMemo(() => {
    if (!accountSearch.trim()) return allAccounts;
    const q = accountSearch.toLowerCase();
    return allAccounts.filter(acc =>
      (acc.label || '').toLowerCase().includes(q) ||
      (acc.email || '').toLowerCase().includes(q)
    );
  }, [allAccounts, accountSearch]);

  const filteredEmployees = useMemo(() => {
    const query = employeeSearch.trim().toLowerCase();
    if (!query) return employees;
    return employees.filter(employee => [
      employee.displayName,
      employee.fullName,
      employee.empID,
      employee.email,
      employee.role,
    ].some(value => String(value || '').toLowerCase().includes(query)));
  }, [employeeSearch, employees]);

  const conflictingAssignments = useMemo(() => {
    if (!editingTeam) return [];
    const selectedKeys = new Set(editingTeam.allowedAccounts.map(email => email.toLowerCase()));
    return podTeams
      .filter(team => team.uid !== editingTeam.uid)
      .flatMap(team => team.allowedAccounts
        .filter(email => selectedKeys.has(email.toLowerCase()))
        .map(email => ({ email, teamName: team.displayName })));
  }, [editingTeam, podTeams]);

  const conflictingMembers = useMemo(() => {
    if (!editingTeam) return [];
    const selectedMemberIds = new Set(editingTeam.memberIds);
    return podTeams
      .filter(team => team.uid !== editingTeam.uid)
      .flatMap(team => team.memberIds
        .filter(uid => selectedMemberIds.has(uid))
        .map(uid => ({ uid, teamName: team.displayName })));
  }, [editingTeam, podTeams]);

  const handleSelectAll = () => {
    if (!editingTeam) return;
    const allFilteredEmails = filteredAccounts.map(a => a.email);
    const combined = Array.from(new Set([...editingTeam.allowedAccounts, ...allFilteredEmails]));
    setEditingTeam({ ...editingTeam, allowedAccounts: combined });
  };

  const handleDeselectAll = () => {
    if (!editingTeam) return;
    const filteredSet = new Set(filteredAccounts.map(a => a.email));
    const remaining = editingTeam.allowedAccounts.filter(a => !filteredSet.has(a));
    setEditingTeam({ ...editingTeam, allowedAccounts: remaining });
  };

  const handleSelectAllEmployees = () => {
    if (!editingTeam) return;
    setEditingTeam({
      ...editingTeam,
      memberIds: uniqueMemberIds([...editingTeam.memberIds, ...filteredEmployees.map(employee => employee.uid)]),
    });
  };

  const handleDeselectAllEmployees = () => {
    if (!editingTeam) return;
    const filteredIds = new Set(filteredEmployees.map(employee => employee.uid));
    setEditingTeam({
      ...editingTeam,
      memberIds: editingTeam.memberIds.filter(uid => !filteredIds.has(uid)),
    });
  };

  return (
    <div className="h-full space-y-6 overflow-y-auto pr-1">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gray-50 dark:bg-gray-800/50 p-4 rounded-xl border border-gray-200 dark:border-gray-700">
        <div>
          <h3 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-500" />
            POD Teams Configuration
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Assign employees across departments and the shops/accounts handled by each POD Team.
          </p>
        </div>
        <button
          onClick={handleAddNew}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Add
        </button>
      </div>

      {/* Loading state */}
      {loading ? (
        <div className="py-12 flex justify-center items-center">
          <Spinner />
        </div>
      ) : podTeams.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl">
          <Users className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <h4 className="text-sm font-medium text-gray-900 dark:text-white">No POD Teams Configured</h4>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-sm mx-auto">
            Click "Add" to assign employees and the shops handled by each team.
          </p>
          <button
            onClick={handleAddNew}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium"
          >
            <Plus className="w-4 h-4" />
            Create First POD Team
          </button>
        </div>
      ) : (
        /* Team Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {podTeams.map(team => (
            <div
              key={team.uid}
              className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700 shadow-sm flex flex-col justify-between hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-lg border border-blue-200 dark:border-blue-800">
                      {team.displayName.charAt(0).toUpperCase() || 'P'}
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900 dark:text-white text-sm">
                        {team.displayName}
                      </h4>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {team.description || 'No description provided'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleEdit(team)}
                      className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                      title="Edit Team"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(team.uid)}
                      className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                      title="Delete Team"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 border-t border-gray-100 pt-3 dark:border-gray-700/50 sm:grid-cols-2">
                  <div>
                    <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
                      <span className="flex items-center gap-1 font-medium text-gray-700 dark:text-gray-300">
                        <UserRound className="h-3.5 w-3.5 text-blue-500" />
                        Employees ({team.memberIds.length})
                      </span>
                    </div>
                    {team.memberIds.length === 0 ? (
                      <span className="text-xs italic text-gray-400">No employees assigned yet</span>
                    ) : (
                      <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto pr-1">
                        {team.memberIds.map(memberId => {
                          const employee = employees.find(item => item.uid === memberId);
                          return (
                            <span
                              key={memberId}
                              className="inline-flex items-center rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
                            >
                              {employee ? getEmployeeLabel(employee) : memberId}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div>
                    <div>
                      <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
                        <span className="flex items-center gap-1 font-medium text-gray-700 dark:text-gray-300">
                          <Store className="h-3.5 w-3.5 text-blue-500" />
                          Assigned Shops ({team.allowedAccounts.length})
                        </span>
                      </div>
                      {team.allowedAccounts.length === 0 ? (
                        <span className="text-xs italic text-gray-400">No shops assigned yet</span>
                      ) : (
                        <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto pr-1">
                          {team.allowedAccounts.map(accEmail => {
                            const accObj = allAccounts.find(a => a.email === accEmail);
                            return (
                              <span
                                key={accEmail}
                                className="inline-flex items-center rounded border border-gray-200 bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
                              >
                                {accObj?.label || accEmail}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit / Create Modal */}
      {isModalOpen && editingTeam && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[110] p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl border border-gray-200 dark:border-gray-800 flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
              <h3 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-500" />
                {podTeams.some(t => t.uid === editingTeam.uid) ? 'Edit POD Team' : 'Create New POD Team'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Form Content */}
            <form onSubmit={handleSaveTeam} className="p-4 flex-1 overflow-y-auto space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Team Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. POD Team Alpha"
                  value={editingTeam.displayName}
                  onChange={e => setEditingTeam({ ...editingTeam, displayName: e.target.value })}
                  className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Description / Notes
                </label>
                <input
                  type="text"
                  placeholder="e.g. Handles Etsy US & CustomCat accounts"
                  value={editingTeam.description || ''}
                  onChange={e => setEditingTeam({ ...editingTeam, description: e.target.value })}
                  className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
                    Assign Employees ({editingTeam.memberIds.length} selected)
                  </label>
                  <div className="flex items-center gap-2 text-xs">
                    <button type="button" onClick={handleSelectAllEmployees} className="font-medium text-blue-600 hover:underline dark:text-blue-400">Select All</button>
                    <span className="text-gray-300">|</span>
                    <button type="button" onClick={handleDeselectAllEmployees} className="text-gray-500 hover:underline dark:text-gray-400">Deselect All</button>
                  </div>
                </div>
                {conflictingMembers.length > 0 && (
                  <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                    {conflictingMembers.length} employee(s) currently belong to another POD and will be moved here when saved.
                  </div>
                )}
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search name, empID, email or role..."
                    value={employeeSearch}
                    onChange={event => setEmployeeSearch(event.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-gray-50 py-1.5 pl-9 pr-3 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                  />
                </div>
                <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100 dark:border-gray-700 dark:divide-gray-800">
                  {filteredEmployees.length === 0 ? (
                    <div className="p-4 text-center text-xs text-gray-400">No employees found</div>
                  ) : filteredEmployees.map(employee => {
                    const isSelected = editingTeam.memberIds.includes(employee.uid);
                    return (
                      <button
                        key={employee.uid}
                        type="button"
                        onClick={() => toggleMember(employee.uid)}
                        className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 ${isSelected ? 'bg-blue-50/50 dark:bg-blue-900/20' : ''}`}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          {isSelected ? <CheckSquare className="h-4 w-4 flex-shrink-0 text-blue-600 dark:text-blue-400" /> : <Square className="h-4 w-4 flex-shrink-0 text-gray-400" />}
                          {employee.photoURL ? (
                            <img src={employee.photoURL} alt="" loading="lazy" className="h-7 w-7 flex-shrink-0 rounded-full object-cover" />
                          ) : (
                            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 font-bold text-gray-500 dark:bg-gray-700 dark:text-gray-300">
                              {getEmployeeLabel(employee).charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-gray-800 dark:text-gray-200">{getEmployeeLabel(employee)}</div>
                            <div className="truncate text-[10px] text-gray-400">{employee.empID || 'No empID'} · {employee.email || employee.uid}</div>
                          </div>
                        </div>
                        <span className="flex-shrink-0 rounded-full bg-gray-100 px-2 py-1 text-[10px] font-bold text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                          {employee.role || 'NO ROLE'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Shop Account Selector */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
                    Assign Shops / Accounts ({editingTeam.allowedAccounts.length} selected)
                  </label>
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={handleSelectAll}
                      className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                    >
                      Select All
                    </button>
                    <span className="text-gray-300">|</span>
                    <button
                      type="button"
                      onClick={handleDeselectAll}
                      className="text-gray-500 dark:text-gray-400 hover:underline"
                    >
                      Deselect All
                    </button>
                  </div>
                </div>
                {conflictingAssignments.length > 0 && (
                  <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                    {conflictingAssignments.length} shop đang thuộc POD khác và sẽ được chuyển sang POD này khi lưu.
                  </div>
                )}

                {/* Account Search input */}
                <div className="relative mb-2">
                  <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Search shops..."
                    value={accountSearch}
                    onChange={e => setAccountSearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-1 focus:ring-blue-500 focus:outline-none text-gray-900 dark:text-white"
                  />
                </div>

                {/* Account Checkboxes */}
                <div className="max-h-56 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-800">
                  {filteredAccounts.length === 0 ? (
                    <div className="p-4 text-center text-xs text-gray-400">No shops found</div>
                  ) : (
                    filteredAccounts.map(acc => {
                      const isSelected = editingTeam.allowedAccounts.includes(acc.email);
                      return (
                        <label
                          key={acc.email}
                          onClick={() => toggleAccount(acc.email)}
                          className={`flex items-center justify-between px-3 py-2 text-xs cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${
                            isSelected ? 'bg-blue-50/50 dark:bg-blue-900/20' : ''
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0 pr-2">
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                            ) : (
                              <Square className="w-4 h-4 text-gray-400 flex-shrink-0" />
                            )}
                            <span className="font-medium text-gray-800 dark:text-gray-200 truncate">
                              {acc.label || acc.email}
                            </span>
                          </div>
                          <span className="text-[10px] text-gray-400 truncate max-w-[150px]">
                            {acc.email}
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Modal Footer Actions */}
              <div className="pt-3 border-t border-gray-200 dark:border-gray-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  {saving ? 'Saving...' : 'Save POD Team'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default PODTeamManager;
