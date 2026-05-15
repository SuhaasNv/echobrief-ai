import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  LayoutGrid,
  Mic,
  Upload,
  MessageSquare,
  CheckSquare,
  Users,
  BarChart3,
  Settings,
  Sun,
  Moon,
  Monitor,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { useTheme } from "@/components/theme/theme-provider";
import { meetings as mockMeetings } from "@/lib/mock-data";

interface PaletteContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

const PaletteContext = createContext<PaletteContextValue | null>(null);

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((o) => !o), []);

  // Global Cmd+K / Ctrl+K listener
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggle]);

  const value = useMemo(() => ({ open, setOpen, toggle }), [open, toggle]);

  return (
    <PaletteContext.Provider value={value}>
      {children}
      <CommandPalette open={open} onOpenChange={setOpen} />
    </PaletteContext.Provider>
  );
}

export function useCommandPalette(): PaletteContextValue {
  const ctx = useContext(PaletteContext);
  if (!ctx) throw new Error("useCommandPalette must be used within CommandPaletteProvider");
  return ctx;
}

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/app", label: "Dashboard", icon: LayoutGrid, shortcut: "G D" },
  { to: "/app/meetings", label: "Meetings", icon: Mic, shortcut: "G M" },
  { to: "/app/upload", label: "Upload audio", icon: Upload, shortcut: "G U" },
  { to: "/app/chat", label: "AI Chat", icon: MessageSquare, shortcut: "G C" },
  { to: "/app/action-items", label: "Action items", icon: CheckSquare, shortcut: "G A" },
  { to: "/app/shared", label: "Shared notes", icon: Users },
  { to: "/app/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/app/settings", label: "Settings", icon: Settings, shortcut: "G S" },
];

function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { setTheme } = useTheme();

  const runAndClose = useCallback(
    (fn: () => void) => {
      fn();
      onOpenChange(false);
    },
    [onOpenChange],
  );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search meetings, navigate, or run a command…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Quick actions">
          <CommandItem
            onSelect={() => runAndClose(() => navigate({ to: "/app/upload" }))}
          >
            <Upload className="h-3.5 w-3.5" />
            <span>Upload a new meeting</span>
            <CommandShortcut>U</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => runAndClose(() => navigate({ to: "/app/chat" }))}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>Ask AI across meetings</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Navigate">
          {NAV_ITEMS.map((item) => (
            <CommandItem
              key={item.to}
              value={`nav ${item.label}`}
              onSelect={() => runAndClose(() => navigate({ to: item.to }))}
            >
              <item.icon className="h-3.5 w-3.5" />
              <span>{item.label}</span>
              {item.shortcut && <CommandShortcut>{item.shortcut}</CommandShortcut>}
            </CommandItem>
          ))}
        </CommandGroup>

        {mockMeetings.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Recent meetings">
              {mockMeetings.slice(0, 5).map((m) => (
                <CommandItem
                  key={m.id}
                  value={`meeting ${m.title} ${m.tags?.join(" ") ?? ""}`}
                  onSelect={() =>
                    runAndClose(() =>
                      navigate({ to: "/app/meetings/$id", params: { id: m.id } }),
                    )
                  }
                >
                  <Mic className="h-3.5 w-3.5" />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate">{m.title}</span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {m.date} · {m.duration}
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        <CommandSeparator />

        <CommandGroup heading="Theme">
          <CommandItem onSelect={() => runAndClose(() => setTheme("light"))}>
            <Sun className="h-3.5 w-3.5" />
            <span>Switch to light</span>
          </CommandItem>
          <CommandItem onSelect={() => runAndClose(() => setTheme("dark"))}>
            <Moon className="h-3.5 w-3.5" />
            <span>Switch to dark</span>
          </CommandItem>
          <CommandItem onSelect={() => runAndClose(() => setTheme("system"))}>
            <Monitor className="h-3.5 w-3.5" />
            <span>Match system</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
