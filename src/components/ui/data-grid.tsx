import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnSizingState,
  type VisibilityState,
  type RowSelectionState,
  type OnChangeFn,
} from "@tanstack/react-table";
import { ArrowUpDown, ArrowUp, ArrowDown, Download, Columns3, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/* ─── Types ─── */

export interface DataGridProps<T> {
  data: T[];
  columns: ColumnDef<T, any>[];
  /** localStorage key for persisting column visibility & sizing */
  storageKey?: string;
  /** Enable row selection checkboxes */
  enableSelection?: boolean;
  /** Callback when selection changes */
  onSelectionChange?: (rows: T[]) => void;
  /** Page size (default 50) */
  pageSize?: number;
  /** CSV export filename */
  exportFilename?: string;
  /** Extra toolbar content (rendered left of built-in buttons) */
  toolbar?: React.ReactNode;
  /** Compact density class override */
  className?: string;
  /** Called when cell is edited inline */
  onCellEdit?: (rowIndex: number, columnId: string, value: any) => void;
}

/* ─── Helpers ─── */

function downloadCSV(headers: string[], rows: string[][], filename: string) {
  const csv = [
    headers.join(","),
    ...rows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ─── Selection column helper ─── */

export function getSelectionColumn<T>(): ColumnDef<T, any> {
  return {
    id: "select",
    size: 32,
    enableSorting: false,
    enableResizing: false,
    header: ({ table }) => (
      <Checkbox
        checked={table.getIsAllPageRowsSelected()}
        onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
        aria-label="Select all"
        className="translate-y-[1px]"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(v) => row.toggleSelected(!!v)}
        aria-label="Select row"
        className="translate-y-[1px]"
      />
    ),
  };
}

/* ─── Editable cell component ─── */

export function EditableCell({
  value: initialValue,
  onSave,
  type = "number",
}: {
  value: number | string;
  onSave: (v: any) => void;
  type?: "number" | "text";
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setValue(initialValue); }, [initialValue]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  if (!editing) {
    return (
      <span
        className="cursor-pointer hover:underline decoration-dashed underline-offset-2 tabular-nums"
        onClick={() => setEditing(true)}
        onKeyDown={(e) => e.key === "Enter" && setEditing(true)}
        tabIndex={0}
        role="button"
      >
        {value}
      </span>
    );
  }

  return (
    <input
      ref={inputRef}
      type={type}
      className="w-full h-6 px-1 text-xs bg-background border border-input rounded text-right font-mono focus:outline-none focus:ring-1 focus:ring-ring"
      value={value}
      onChange={(e) => setValue(type === "number" ? Number(e.target.value) : e.target.value)}
      onBlur={() => { setEditing(false); onSave(value); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") { setEditing(false); onSave(value); }
        if (e.key === "Escape") { setEditing(false); setValue(initialValue); }
      }}
    />
  );
}

/* ─── DataGrid Component ─── */

export default function DataGrid<T>({
  data,
  columns: userColumns,
  storageKey,
  enableSelection = false,
  onSelectionChange,
  pageSize = 50,
  exportFilename = "export.csv",
  toolbar,
  className,
  onCellEdit,
}: DataGridProps<T>) {
  // Build columns (prepend selection if enabled)
  const columns = useMemo(() => {
    if (enableSelection) return [getSelectionColumn<T>(), ...userColumns];
    return userColumns;
  }, [userColumns, enableSelection]);

  // Persisted state
  const loadState = <S,>(key: string, fallback: S): S => {
    if (!storageKey) return fallback;
    try {
      const raw = localStorage.getItem(`dg_${storageKey}_${key}`);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  };

  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(() => loadState("vis", {}));
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(() => loadState("size", {}));
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  // Persist preferences
  useEffect(() => {
    if (!storageKey) return;
    localStorage.setItem(`dg_${storageKey}_vis`, JSON.stringify(columnVisibility));
  }, [columnVisibility, storageKey]);

  useEffect(() => {
    if (!storageKey) return;
    localStorage.setItem(`dg_${storageKey}_size`, JSON.stringify(columnSizing));
  }, [columnSizing, storageKey]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnVisibility, columnSizing, rowSelection },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnSizingChange: setColumnSizing,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    columnResizeMode: "onChange",
    enableColumnResizing: true,
    initialState: { pagination: { pageSize } },
    meta: { onCellEdit },
  });

  // Notify parent of selection changes
  useEffect(() => {
    if (!onSelectionChange) return;
    const selectedRows = table.getSelectedRowModel().rows.map(r => r.original);
    onSelectionChange(selectedRows);
  }, [rowSelection]);

  // CSV export
  const handleExport = useCallback(() => {
    const visibleCols = table.getVisibleLeafColumns().filter(c => c.id !== "select");
    const headers = visibleCols.map(c => typeof c.columnDef.header === "string" ? c.columnDef.header : c.id);
    const rows = table.getFilteredRowModel().rows.map(row =>
      visibleCols.map(col => {
        const val = row.getValue(col.id);
        return val != null ? String(val) : "";
      })
    );
    downloadCSV(headers, rows, exportFilename);
  }, [table, exportFilename]);

  const pageCount = table.getPageCount();
  const pageIndex = table.getState().pagination.pageIndex;

  return (
    <div className={cn("space-y-2", className)}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {toolbar}
        <div className="ml-auto flex items-center gap-1.5">
          {enableSelection && Object.keys(rowSelection).length > 0 && (
            <span className="text-xs text-muted-foreground">{Object.keys(rowSelection).length} selected</span>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 gap-1 text-xs">
                <Columns3 className="h-3.5 w-3.5" /> Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              {table.getAllLeafColumns().filter(c => c.id !== "select").map(col => (
                <DropdownMenuCheckboxItem
                  key={col.id}
                  checked={col.getIsVisible()}
                  onCheckedChange={(v) => col.toggleVisibility(!!v)}
                  className="text-xs"
                >
                  {typeof col.columnDef.header === "string" ? col.columnDef.header : col.id}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={handleExport}>
            <Download className="h-3.5 w-3.5" /> CSV
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="border border-border rounded-md overflow-auto">
        <table className="w-full text-xs" style={{ minWidth: table.getTotalSize() }}>
          <thead className="bg-muted/50 sticky top-0 z-10">
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => (
                  <th
                    key={header.id}
                    className="relative px-2 py-1.5 text-left font-medium text-muted-foreground whitespace-nowrap select-none"
                    style={{ width: header.getSize() }}
                  >
                    {header.isPlaceholder ? null : (
                      <div
                        className={cn("flex items-center gap-1", header.column.getCanSort() && "cursor-pointer hover:text-foreground")}
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getIsSorted() === "asc" && <ArrowUp className="h-3 w-3" />}
                        {header.column.getIsSorted() === "desc" && <ArrowDown className="h-3 w-3" />}
                        {header.column.getCanSort() && !header.column.getIsSorted() && <ArrowUpDown className="h-3 w-3 opacity-30" />}
                      </div>
                    )}
                    {/* Resize handle */}
                    {header.column.getCanResize() && (
                      <div
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        className={cn(
                          "absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none",
                          header.column.getIsResizing() ? "bg-primary" : "hover:bg-border"
                        )}
                      />
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="py-8 text-center text-muted-foreground">
                  No data
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map(row => (
                <tr
                  key={row.id}
                  className={cn(
                    "border-t border-border hover:bg-muted/30 transition-colors",
                    row.getIsSelected() && "bg-primary/5"
                  )}
                >
                  {row.getVisibleCells().map(cell => (
                    <td key={cell.id} className="px-2 py-1" style={{ width: cell.column.getSize() }}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pageCount > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {table.getFilteredRowModel().rows.length} rows · Page {pageIndex + 1} of {pageCount}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
