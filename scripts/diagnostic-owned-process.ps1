# Diagnostic-only Windows ownership broker. See docs/diagnostics/owned-process-protocol.md.
# Requires 64-bit Windows PowerShell 5.1. Stdout is reserved for bounded NDJSON.
[CmdletBinding(DefaultParameterSetName = 'Executable')]
param(
    [Parameter(Mandatory = $true, ParameterSetName = 'Executable')]
    [string]$Executable,
    [Parameter(ParameterSetName = 'Executable')]
    [string]$ArgumentsJson = '[]',
    [Parameter(ParameterSetName = 'Executable')]
    [string]$WorkingDirectory = '',
    [Parameter(Mandatory = $true, ParameterSetName = 'SelfTest')]
    [switch]$OwnedChildSelfTest,
    [Parameter(Mandatory = $true, ParameterSetName = 'CompileOnly')]
    [switch]$CompileOnly,
    [Parameter(Mandatory = $true, ParameterSetName = 'DiagnosticsFixtureOnly')]
    [switch]$DiagnosticsFixtureOnly,
    [ValidateRange(5, 300)][int]$LifetimeSeconds = 180,
    [ValidateRange(1, 30)][int]$TeardownSeconds = 10
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT' -or [IntPtr]::Size -ne 8 -or $PSVersionTable.PSEdition -ne 'Desktop') {
    [Console]::Error.WriteLine('Requires 64-bit Windows PowerShell 5.1; no process was launched.')
    exit 2
}
if ($DiagnosticsFixtureOnly) {
    & (Join-Path $PSScriptRoot '../tests/diagnostic-compiler-diagnostics.fixture.ps1')
    exit $LASTEXITCODE
}
[string[]]$launchArguments = @()
if (-not $CompileOnly) {
    try {
        $parsedArguments = ConvertFrom-Json -InputObject $ArgumentsJson
        # ConvertFrom-Json unwraps arrays, so validate the original JSON's outer shape too.
        if ($ArgumentsJson.Trim() -notmatch '^\[.*\]$' -or $ArgumentsJson.Length -gt 30000) { throw 'Invalid argument array.' }
        [string[]]$launchArguments = @()
        foreach ($argument in $parsedArguments) {
            if ($argument -isnot [string] -or $argument.Contains([char]0)) { throw 'Arguments must be strings without NUL.' }
            $launchArguments += $argument
        }
        if (-not $OwnedChildSelfTest) {
            if (-not [IO.Path]::IsPathRooted($Executable) -or -not [IO.File]::Exists($Executable)) { throw 'Executable must be an existing absolute path.' }
            if ($WorkingDirectory -and (-not [IO.Path]::IsPathRooted($WorkingDirectory) -or -not [IO.Directory]::Exists($WorkingDirectory))) { throw 'Working directory must be an existing absolute path.' }
        }
    } catch {
        [Console]::Error.WriteLine('Invalid launcher arguments; no process was launched.')
        exit 2
    }
}

$source = @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

public static class DiagnosticOwnedProcess
{
    const uint CREATE_SUSPENDED = 0x00000004, CREATE_NO_WINDOW = 0x08000000;
    const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000, STARTF_USESTDHANDLES = 0x00000100;
    const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    const uint JOB_OBJECT_LIMIT_BREAKAWAY_OK = 0x00000800, JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK = 0x00001000;
    const uint HANDLE_FLAG_INHERIT = 1, PROCESS_QUERY_LIMITED_INFORMATION = 0x1000, SYNCHRONIZE = 0x00100000;
    const uint WAIT_OBJECT_0 = 0, WAIT_TIMEOUT = 258, INFINITE_FAILURE = 0xffffffff;
    const int JobObjectBasicAccountingInformation = 1, JobObjectBasicProcessIdList = 3, JobObjectExtendedLimitInformation = 9;
    const int MAX_PROCESSES = 4096, MAX_COMMANDS = 256, MAX_LINE = 4096;
    static readonly IntPtr INVALID_HANDLE_VALUE = new IntPtr(-1);

    [StructLayout(LayoutKind.Sequential)] struct SECURITY_ATTRIBUTES { public int nLength; public IntPtr lpSecurityDescriptor; public int bInheritHandle; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct STARTUPINFO {
        public uint cb; public string lpReserved, lpDesktop, lpTitle; public uint dwX, dwY, dwXSize, dwYSize;
        public uint dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags; public ushort wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }
    [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }
    [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public uint dwProcessId, dwThreadId; }
    [StructLayout(LayoutKind.Sequential)] struct FILETIME { public uint Low, High; }
    [StructLayout(LayoutKind.Sequential)] struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit;
        public UIntPtr Affinity; public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
    [StructLayout(LayoutKind.Sequential)] struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation; public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }
    [StructLayout(LayoutKind.Sequential)] struct JOBOBJECT_BASIC_ACCOUNTING_INFORMATION {
        public long TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime;
        public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses;
    }
    [StructLayout(LayoutKind.Sequential)] struct PROCESS_BASIC_INFORMATION {
        public IntPtr Reserved1, PebBaseAddress, Reserved2A, Reserved2B, UniqueProcessId, InheritedFromUniqueProcessId;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int informationClass, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, uint size);
    [DllImport("kernel32.dll", EntryPoint = "QueryInformationJobObject", SetLastError = true)] static extern bool QueryJobLimits(IntPtr job, int informationClass, out JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, uint size, out uint returned);
    [DllImport("kernel32.dll", EntryPoint = "QueryInformationJobObject", SetLastError = true)] static extern bool QueryJobAccounting(IntPtr job, int informationClass, out JOBOBJECT_BASIC_ACCOUNTING_INFORMATION info, uint size, out uint returned);
    [DllImport("kernel32.dll", EntryPoint = "QueryInformationJobObject", SetLastError = true)] static extern bool QueryJobIds(IntPtr job, int informationClass, IntPtr info, uint size, out uint returned);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetHandleInformation(IntPtr handle, out uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(IntPtr job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr process, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetProcessTimes(IntPtr process, out FILETIME creation, out FILETIME exit, out FILETIME kernel, out FILETIME user);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder image, ref uint size);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CreateProcess(string application, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string directory, ref STARTUPINFOEX startup, out PROCESS_INFORMATION process);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateFile(string path, uint access, uint share, ref SECURITY_ATTRIBUTES attributes, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr process, int informationClass, out PROCESS_BASIC_INFORMATION info, int size, out int returned);

    sealed class Identity {
        public uint Pid; public string Creation, Basename; public uint? ParentPid; public IntPtr Handle;
        public Dictionary<string, object> Record() {
            return new Dictionary<string, object> { {"pid", Pid}, {"creationTimeFileTime", Creation}, {"executableBasename", Basename}, {"parentPid", ParentPid}, {"parentIdentityVerified", false} };
        }
    }
    sealed class Broker {
        readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 2 * 1024 * 1024 };
        readonly Stopwatch clock = Stopwatch.StartNew();
        readonly Dictionary<uint, Identity> observed = new Dictionary<uint, Identity>();
        readonly List<string> errors = new List<string>();
        IntPtr job = IntPtr.Zero, thread = IntPtr.Zero, unverifiedRootHandle = IntPtr.Zero;
        Identity root; bool assigned, resumed, rootExitReported, ownershipVerified, protocolWritable = true;
        int sequence; readonly int lifetimeMs, teardownMs; string stage = "startup";
        public Broker(int lifetimeSeconds, int teardownSeconds) { lifetimeMs = lifetimeSeconds * 1000; teardownMs = teardownSeconds * 1000; }

        void Check(bool ok, string operation) { if (!ok) throw new InvalidOperationException(operation + ":win32:" + Marshal.GetLastWin32Error()); }
        void Fail(string code) { errors.Add(code); Emit("error", new Dictionary<string, object> { {"stage", stage}, {"code", code}, {"cleanupVerified", false} }); }
        void Emit(string type, Dictionary<string, object> data) {
            data["type"] = type; data["sequence"] = ++sequence; data["elapsedMs"] = Math.Round(clock.Elapsed.TotalMilliseconds, 3);
            if (!protocolWritable) return;
            try { Console.Out.WriteLine(json.Serialize(data)); Console.Out.Flush(); }
            catch (IOException) { protocolWritable = false; errors.Add("protocol_output_closed"); }
        }
        string CreationTime(IntPtr handle) {
            FILETIME created, exited, kernel, user;
            Check(GetProcessTimes(handle, out created, out exited, out kernel, out user), "GetProcessTimes");
            ulong value = ((ulong)created.High << 32) | created.Low;
            if (value == 0) throw new InvalidOperationException("missing_creation_time");
            return value.ToString(System.Globalization.CultureInfo.InvariantCulture);
        }
        Identity ReadIdentity(uint pid, IntPtr handle) {
            var basename = new StringBuilder(32768); uint size = (uint)basename.Capacity;
            string creation = CreationTime(handle);
            Check(QueryFullProcessImageName(handle, 0, basename, ref size), "QueryFullProcessImageName");
            var identity = new Identity { Pid = pid, Creation = creation, Basename = Path.GetFileName(basename.ToString()), Handle = handle };
            if (String.IsNullOrEmpty(identity.Basename)) throw new InvalidOperationException("missing_executable_basename");
            PROCESS_BASIC_INFORMATION info; int returned;
            // Parent PID is an informational hint only; it never establishes ownership.
            if (NtQueryInformationProcess(handle, 0, out info, Marshal.SizeOf(typeof(PROCESS_BASIC_INFORMATION)), out returned) == 0) {
                long parent = info.InheritedFromUniqueProcessId.ToInt64();
                if (parent >= 0 && parent <= UInt32.MaxValue) identity.ParentPid = (uint)parent;
            }
            return identity;
        }
        void VerifyIdentity(Identity identity) {
            if (CreationTime(identity.Handle) != identity.Creation) throw new InvalidOperationException("creation_identity_changed");
        }
        JOBOBJECT_BASIC_ACCOUNTING_INFORMATION Accounting() {
            JOBOBJECT_BASIC_ACCOUNTING_INFORMATION info; uint returned;
            Check(QueryJobAccounting(job, JobObjectBasicAccountingInformation, out info, (uint)Marshal.SizeOf(typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION)), out returned), "QueryJobAccounting");
            return info;
        }
        List<uint> JobPids() {
            for (int capacity = 32; capacity <= MAX_PROCESSES; capacity *= 2) {
                int size = checked(8 + IntPtr.Size * capacity); IntPtr memory = Marshal.AllocHGlobal(size);
                try {
                    uint returned; bool ok = QueryJobIds(job, JobObjectBasicProcessIdList, memory, (uint)size, out returned);
                    if (!ok) {
                        int error = Marshal.GetLastWin32Error();
                        if (error == 234) continue;
                        throw new InvalidOperationException("QueryJobIds:win32:" + error);
                    }
                    uint assignedCount = unchecked((uint)Marshal.ReadInt32(memory, 0));
                    uint count = unchecked((uint)Marshal.ReadInt32(memory, 4));
                    if (assignedCount > capacity || count > capacity || count > assignedCount) throw new InvalidOperationException("job_inventory_truncated");
                    var pids = new List<uint>();
                    for (int i = 0; i < count; i++) {
                        long pid = Marshal.ReadIntPtr(memory, 8 + i * IntPtr.Size).ToInt64();
                        if (pid <= 0 || pid > UInt32.MaxValue || pids.Contains((uint)pid)) throw new InvalidOperationException("invalid_job_pid");
                        pids.Add((uint)pid);
                    }
                    return pids;
                } finally { Marshal.FreeHGlobal(memory); }
            }
            throw new InvalidOperationException("job_inventory_capacity_exceeded");
        }
        Dictionary<string, object> Inventory() {
            var records = new List<Dictionary<string, object>>();
            foreach (uint pid in JobPids()) {
                Identity identity; bool member;
                if (!observed.TryGetValue(pid, out identity)) {
                    if (observed.Count >= MAX_PROCESSES) throw new InvalidOperationException("observed_identity_capacity_exceeded");
                    IntPtr handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, false, pid);
                    Check(handle != IntPtr.Zero, "OpenOwnedProcess");
                    try {
                        Check(IsProcessInJob(handle, job, out member), "IsProcessInJob");
                        if (!member) throw new InvalidOperationException("pid_not_in_owned_job");
                        identity = ReadIdentity(pid, handle);
                        observed.Add(pid, identity); handle = IntPtr.Zero;
                    } finally { if (handle != IntPtr.Zero) CloseHandle(handle); }
                } else if (Exited(identity.Handle)) {
                    // A current PID must never be attributed to an exited retained identity.
                    // This rejects PID reuse (and conservatively rejects an exit/query race).
                    throw new InvalidOperationException("listed_pid_has_exited_retained_identity");
                }
                Check(IsProcessInJob(identity.Handle, job, out member), "IsProcessInJob");
                if (!member) throw new InvalidOperationException("observed_process_left_job");
                VerifyIdentity(identity);
                var record = identity.Record(); record["exitState"] = Exited(identity.Handle) ? "exited" : "running";
                records.Add(record);
            }
            var accounting = Accounting();
            return new Dictionary<string, object> {
                {"processes", records}, {"activeProcessCount", accounting.ActiveProcesses}, {"totalProcesses", accounting.TotalProcesses},
                {"totalTerminatedProcesses", accounting.TotalTerminatedProcesses}, {"ownershipVerified", ownershipVerified},
                {"inventoryIsAtomic", false}, {"observedHistoryIsExhaustive", false}
            };
        }
        bool Exited(IntPtr handle) {
            uint result = WaitForSingleObject(handle, 0);
            if (result != WAIT_OBJECT_0 && result != WAIT_TIMEOUT) throw new InvalidOperationException("WaitForSingleObject:win32:" + Marshal.GetLastWin32Error());
            return result == WAIT_OBJECT_0;
        }
        void ReportRootExit() {
            if (root == null || rootExitReported || !Exited(root.Handle)) return;
            VerifyIdentity(root); uint code; Check(GetExitCodeProcess(root.Handle, out code), "GetExitCodeProcess");
            rootExitReported = true; var data = root.Record(); data["exitCode"] = code; Emit("root_exit", data);
        }
        void CreateOwnedJob() {
            job = CreateJobObject(IntPtr.Zero, null); Check(job != IntPtr.Zero, "CreateJobObject");
            Check(SetHandleInformation(job, HANDLE_FLAG_INHERIT, 0), "SetJobNonInheritable");
            uint flags; Check(GetHandleInformation(job, out flags), "GetJobHandleInformation");
            if ((flags & HANDLE_FLAG_INHERIT) != 0) throw new InvalidOperationException("job_handle_inheritable");
            var limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION(); limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            Check(SetInformationJobObject(job, JobObjectExtendedLimitInformation, ref limits, (uint)Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION))), "SetJobLimits");
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION actual; uint returned;
            Check(QueryJobLimits(job, JobObjectExtendedLimitInformation, out actual, (uint)Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION)), out returned), "QueryJobLimits");
            uint actualFlags = actual.BasicLimitInformation.LimitFlags;
            if ((actualFlags & JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE) == 0 || (actualFlags & (JOB_OBJECT_LIMIT_BREAKAWAY_OK | JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK)) != 0)
                throw new InvalidOperationException("unsafe_job_limits");
            Emit("job_created", new Dictionary<string, object> { {"killOnClose", true}, {"breakawayAllowed", false}, {"handleInheritable", false} });
        }
        public static string QuoteArgument(string value) {
            if (value.IndexOf('\0') >= 0) throw new InvalidOperationException("argument_contains_nul");
            var text = new StringBuilder("\""); int slashes = 0;
            foreach (char c in value) {
                if (c == '\\') { slashes++; continue; }
                if (c == '"') { text.Append('\\', slashes * 2 + 1); text.Append(c); slashes = 0; continue; }
                text.Append('\\', slashes); slashes = 0; text.Append(c);
            }
            text.Append('\\', slashes * 2); text.Append('"'); return text.ToString();
        }
        void Launch(string executable, string[] args, string directory) {
            var command = new StringBuilder(QuoteArgument(executable));
            foreach (string arg in args) command.Append(" ").Append(QuoteArgument(arg));
            if (command.Length > 32766) throw new InvalidOperationException("command_line_too_long");
            var security = new SECURITY_ATTRIBUTES { nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)), bInheritHandle = 1 };
            IntPtr nul = CreateFile("NUL", 0x80000000 | 0x40000000, 3, ref security, 3, 0, IntPtr.Zero);
            Check(nul != INVALID_HANDLE_VALUE, "CreateNullStandardHandles");
            IntPtr attributes = IntPtr.Zero, handleList = IntPtr.Zero; bool initialized = false;
            try {
                IntPtr size = IntPtr.Zero;
                InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
                if (size == IntPtr.Zero) throw new InvalidOperationException("missing_attribute_list_size");
                attributes = Marshal.AllocHGlobal(size);
                Check(InitializeProcThreadAttributeList(attributes, 1, 0, ref size), "InitializeHandleList"); initialized = true;
                handleList = Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(handleList, nul);
                // PROC_THREAD_ATTRIBUTE_HANDLE_LIST permits ONLY NUL to cross the launch boundary.
                Check(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x00020002), handleList, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero), "SetInheritedHandleAllowlist");
                var startup = new STARTUPINFOEX(); startup.StartupInfo.cb = (uint)Marshal.SizeOf(typeof(STARTUPINFOEX));
                startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES; startup.StartupInfo.hStdInput = nul; startup.StartupInfo.hStdOutput = nul; startup.StartupInfo.hStdError = nul;
                startup.lpAttributeList = attributes; PROCESS_INFORMATION process;
                Check(CreateProcess(executable, command, IntPtr.Zero, IntPtr.Zero, true,
                    CREATE_SUSPENDED | CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT, IntPtr.Zero,
                    String.IsNullOrEmpty(directory) ? null : directory, ref startup, out process), "CreateProcessSuspended");
                // Retain the kernel handle immediately, including when identity or assignment fails.
                unverifiedRootHandle = process.hProcess; thread = process.hThread;
                root = ReadIdentity(process.dwProcessId, process.hProcess); observed.Add(root.Pid, root);
                Emit("created_suspended", new Dictionary<string, object> { {"root", root.Record()} });
                Check(AssignProcessToJobObject(job, root.Handle), "AssignProcessToJobObject"); assigned = true;
                bool member; Check(IsProcessInJob(root.Handle, job, out member), "VerifyRootJobMembership");
                if (!member) throw new InvalidOperationException("root_job_assignment_unverified");
                VerifyIdentity(root); ownershipVerified = true;
                Emit("job_assigned", new Dictionary<string, object> { {"root", root.Record()}, {"jobVerified", true} });
                uint previous = ResumeThread(thread);
                if (previous == INFINITE_FAILURE) throw new InvalidOperationException("ResumeThread:win32:" + Marshal.GetLastWin32Error());
                if (previous != 1) throw new InvalidOperationException("unexpected_suspend_count");
                resumed = true; CloseHandle(thread); thread = IntPtr.Zero;
                Emit("root_resumed", new Dictionary<string, object> { {"root", root.Record()} });
            } finally {
                if (initialized) DeleteProcThreadAttributeList(attributes);
                if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes);
                if (handleList != IntPtr.Zero) Marshal.FreeHGlobal(handleList);
                CloseHandle(nul);
            }
        }
        static string ReadBoundedLine() {
            var line = new StringBuilder(); int c;
            while ((c = Console.In.Read()) != -1) {
                if (c == '\n') return line.ToString().TrimEnd('\r');
                if (line.Length >= MAX_LINE) throw new InvalidOperationException("protocol_line_limit");
                line.Append((char)c);
            }
            if (line.Length != 0) throw new InvalidOperationException("protocol_truncated_line");
            return null;
        }
        void ProtocolLoop() {
            Task<string> pending = Task.Factory.StartNew<string>(ReadBoundedLine);
            for (int commands = 0; ; ) {
                ReportRootExit();
                if (!protocolWritable) throw new InvalidOperationException("protocol_output_unavailable");
                if (clock.ElapsedMilliseconds >= lifetimeMs) throw new InvalidOperationException("lifetime_deadline");
                if (!pending.Wait(100)) continue;
                string line = pending.Result;
                if (line == null) { Emit("stdin_closed", new Dictionary<string, object>()); Teardown("stdin_closed", null); return; }
                if (++commands > MAX_COMMANDS) throw new InvalidOperationException("protocol_command_limit");
                Dictionary<string, object> command;
                try { command = json.Deserialize<Dictionary<string, object>>(line); }
                catch { throw new InvalidOperationException("invalid_protocol_json"); }
                object actionValue, idValue;
                if (command == null || !command.TryGetValue("command", out actionValue) || !(actionValue is string) ||
                    !command.TryGetValue("requestId", out idValue) || !(idValue is string) || ((string)idValue).Length == 0 || ((string)idValue).Length > 128 || command.Count != 2)
                    throw new InvalidOperationException("invalid_protocol_command");
                string action = (string)actionValue, requestId = (string)idValue;
                if (action == "terminate") { Teardown("command", requestId); return; }
                if (action != "inspect") throw new InvalidOperationException("unknown_protocol_command");
                stage = "inspect"; var inventory = Inventory(); inventory["requestId"] = requestId; Emit("inventory", inventory);
                pending = Task.Factory.StartNew<string>(ReadBoundedLine);
            }
        }
        void Teardown(string reason, string requestId) {
            stage = "teardown";
            Emit("terminate_requested", new Dictionary<string, object> { {"reason", reason}, {"requestId", requestId}, {"method", "TerminateJobObject"} });
            bool zero = false, rootExited = false; uint? rootCode = null; uint? active = null;
            // A failed identity query is sticky uncertainty, but must not bypass termination.
            // The private job and original CreateProcess handle are kernel object identities.
            try { if (root != null) VerifyIdentity(root); }
            catch (Exception ex) { errors.Add(ErrorCode(ex)); }
            try { if (job != IntPtr.Zero) Check(TerminateJobObject(job, 137), "TerminateJobObject"); }
            catch (Exception ex) { errors.Add(ErrorCode(ex)); }
            try {
                // Assignment may fail (including nested-job restrictions). The suspended root's
                // ORIGINAL kernel handle, never a PID lookup, is the only safe emergency target.
                if (!assigned && unverifiedRootHandle != IntPtr.Zero) {
                    Emit("unassigned_root_termination", new Dictionary<string, object> { {"method", "TerminateProcessOriginalHandle"}, {"wasResumed", resumed} });
                    if (!Exited(unverifiedRootHandle)) Check(TerminateProcess(unverifiedRootHandle, 137), "TerminateUnassignedRoot");
                }
            } catch (Exception ex) { errors.Add(ErrorCode(ex)); }
            try {
                var deadline = Stopwatch.StartNew(); bool jobQueryFailed = false;
                while (deadline.ElapsedMilliseconds < teardownMs) {
                    // Wait on the original root even when job accounting itself becomes uncertain.
                    rootExited = unverifiedRootHandle == IntPtr.Zero || Exited(unverifiedRootHandle);
                    if (!jobQueryFailed) {
                        try {
                            var accounting = Accounting(); active = accounting.ActiveProcesses;
                            var pids = JobPids();
                            if (active == 0 && pids.Count == 0 && rootExited) { zero = true; break; }
                        } catch (Exception ex) { errors.Add(ErrorCode(ex)); jobQueryFailed = true; }
                    }
                    if (jobQueryFailed && rootExited) break;
                    Thread.Sleep(50);
                }
                if (!zero) errors.Add(deadline.ElapsedMilliseconds >= teardownMs ? "teardown_deadline_or_surviving_owned_processes" : "owned_cleanup_not_verified");
                ReportRootExit();
                if (unverifiedRootHandle != IntPtr.Zero && rootExited) {
                    uint code; Check(GetExitCodeProcess(unverifiedRootHandle, out code), "GetRootExitCode"); rootCode = code;
                    if (root == null) Emit("root_exit", new Dictionary<string, object> { {"rootIdentityVerified", false}, {"exitCode", code} });
                }
            } catch (Exception ex) { errors.Add(ErrorCode(ex)); }
            var history = new List<Dictionary<string, object>>();
            foreach (Identity identity in observed.Values) {
                var record = identity.Record();
                try { VerifyIdentity(identity); record["exitState"] = Exited(identity.Handle) ? "exited" : "running"; }
                catch (Exception ex) { record["exitState"] = "unknown"; errors.Add(ErrorCode(ex)); }
                history.Add(record);
            }
            Emit("terminated", new Dictionary<string, object> {
                {"requestId", requestId}, {"reason", reason}, {"activeProcessCount", active}, {"rootExited", rootExited}, {"rootExitCode", rootCode},
                {"cleanupVerified", zero && ownershipVerified && errors.Count == 0}, {"ownershipVerified", ownershipVerified},
                {"errors", errors.ToArray()}, {"observedProcesses", history}, {"observedHistoryIsExhaustive", false}
            });
        }
        static string ErrorCode(Exception ex) {
            while (ex is AggregateException && ex.InnerException != null) ex = ex.InnerException;
            // Only messages constructed by this broker are exposed. Runtime errors cannot leak argv.
            return ex is InvalidOperationException ? ex.Message : "runtime_error:" + ex.GetType().Name;
        }
        public int Run(string executable, string[] args, string directory, bool selfTest) {
            try {
                CreateOwnedJob(); stage = "launch";
                if (selfTest) {
                    executable = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe");
                    string child = Convert.ToBase64String(Encoding.Unicode.GetBytes("Start-Sleep -Seconds 120"));
                    string script = "$p = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList @('-NoProfile','-NonInteractive','-EncodedCommand','" + child + "') -NoNewWindow -PassThru; Start-Sleep -Milliseconds 1500; exit 0";
                    args = new string[] { "-NoProfile", "-NonInteractive", "-EncodedCommand", Convert.ToBase64String(Encoding.Unicode.GetBytes(script)) }; directory = null;
                }
                Launch(executable, args, directory); stage = "ready";
                Dictionary<string, object> inventory = null;
                if (selfTest) {
                    var timeout = Stopwatch.StartNew(); bool childVerified = false;
                    while (timeout.ElapsedMilliseconds < 10000 && clock.ElapsedMilliseconds < lifetimeMs) {
                        inventory = Inventory();
                        var members = (List<Dictionary<string, object>>)inventory["processes"];
                        if (members.Count >= 2 && !Exited(root.Handle)) { childVerified = true; break; }
                        if (Exited(root.Handle)) break;
                        Thread.Sleep(50);
                    }
                    if (!childVerified) throw new InvalidOperationException("owned_child_self_test_not_observed");
                } else inventory = Inventory();
                inventory["root"] = root.Record(); inventory["jobVerified"] = ownershipVerified;
                inventory["ownedChildSelfTest"] = selfTest; inventory["lifetimeSeconds"] = lifetimeMs / 1000;
                Emit("ready", inventory); stage = "protocol"; ProtocolLoop();
            } catch (Exception ex) { Fail(ErrorCode(ex)); Teardown("failure", null); }
            finally {
                if (thread != IntPtr.Zero) CloseHandle(thread);
                // Kill-on-close is a final safeguard, NOT evidence of verified cleanup.
                if (job != IntPtr.Zero) CloseHandle(job);
                foreach (Identity identity in observed.Values) CloseHandle(identity.Handle);
                if (root == null && unverifiedRootHandle != IntPtr.Zero) CloseHandle(unverifiedRootHandle);
            }
            return errors.Count == 0 && ownershipVerified ? 0 : 1;
        }
    }
    public static int Run(string executable, string[] args, string directory, bool selfTest, int lifetimeSeconds, int teardownSeconds) {
        Console.InputEncoding = new UTF8Encoding(false); Console.OutputEncoding = new UTF8Encoding(false);
        return new Broker(lifetimeSeconds, teardownSeconds).Run(executable, args, directory, selfTest);
    }
}
'@
# Preserve the original Add-Type provider, default options, references and strict warning
# behavior. Capture errors instead of discarding them; any captured error forbids Run.
. (Join-Path $PSScriptRoot 'diagnostic-compiler-diagnostics.ps1')
$compilerReferences = @('System.dll', 'System.Web.Extensions.dll', 'System.Core.dll')
$compilerErrors = @()
$compiledTypes = @()
$compileClock = [Diagnostics.Stopwatch]::StartNew()
try {
    # SilentlyContinue captures all diagnostics, but DOES NOT authorize execution after
    # any error or change Add-Type's warning-as-error policy. Do not add IgnoreWarnings.
    $compiledTypes = @(Add-Type -TypeDefinition $source -ReferencedAssemblies $compilerReferences -PassThru -ErrorAction SilentlyContinue -ErrorVariable +compilerErrors)
} catch {
    $compilerErrors += $_
}
$compileSucceeded = $compilerErrors.Count -eq 0 -and $compiledTypes.Count -gt 0
if ($CompileOnly -or -not $compileSucceeded) {
    $extraction = Get-BoundedCompilerDiagnostics -Records $compilerErrors -KnownSourceLines ($source -split '\r?\n')
    $diagnostics = @($extraction.diagnostics)
    if (-not $compileSucceeded -and $diagnostics.Count -eq 0) {
        $diagnostics = @([ordered]@{ errorNumber = 'NO_COMPILED_TYPE'; sourceLine = $null; column = $null; isWarning = $null; errorText = 'Add-Type did not return a compiled type.' })
    }
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try { $sourceHash = [BitConverter]::ToString($sha256.ComputeHash([Text.Encoding]::UTF8.GetBytes($source))).Replace('-', '').ToLowerInvariant() }
    finally { $sha256.Dispose() }
    $compileRecord = [ordered]@{
        type = 'compilation'; sequence = 1; elapsedMs = [Math]::Round($compileClock.Elapsed.TotalMilliseconds, 3)
        success = $compileSucceeded; compileOnly = [bool]$CompileOnly
        brokerInvoked = $false; targetLaunched = $false; jobCreated = $false
        sourceSha256 = $sourceHash
        powershellVersion = $PSVersionTable.PSVersion.ToString()
        clrVersion = [Environment]::Version.ToString()
        provider = 'Add-Type default CSharp CodeDom provider'
        explicitReferences = $compilerReferences
        compilerOptions = 'Add-Type defaults, unchanged'
        strictWarnings = $true
        diagnosticLimit = 8; diagnosticTextLimit = 512
        diagnosticInputRecordCount = $compilerErrors.Count
        diagnosticsMayBeTruncated = $extraction.truncated
        diagnosticTraversal = [ordered]@{
            nodesVisited = $extraction.nodesVisited; nodeLimit = $extraction.nodeLimit; depthLimit = $extraction.depthLimit
            messageScanLimit = $extraction.messageScanLimit; truncation = $extraction.truncation
            observedClrTypes = $extraction.observedClrTypes; unknownClrTypes = $extraction.unknownClrTypes
            targetClrTypes = $extraction.targetClrTypes
        }
        diagnostics = $diagnostics
    }
    [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
    $serializedCompileRecord = $compileRecord | ConvertTo-Json -Depth 6 -Compress
    if ($CompileOnly) {
        # PowerShell success-stream output supports same-process Tee-Object capture.
        Write-Output -InputObject $serializedCompileRecord
    } else {
        [Console]::Error.WriteLine($serializedCompileRecord)
        [Console]::Error.Flush()
    }
}
if (-not $compileSucceeded) { exit 2 }
# CompileOnly is an exclusive parameter set and cannot fall through to broker startup.
# No embedded C# method is invoked; no broker job, root or browser is created.
if ($CompileOnly) { exit 0 }
$code = [DiagnosticOwnedProcess]::Run($Executable, $launchArguments, $WorkingDirectory, [bool]$OwnedChildSelfTest, $LifetimeSeconds, $TeardownSeconds)
exit $code
