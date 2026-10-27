<script lang="ts">
export type ProcessRow = { pid: string; name: string; cpu: number | null; memory: number | null };
</script>

<script setup lang="ts">
import { h, resolveComponent } from "vue";
import type { TableColumn } from "@nuxt/ui";
import type { ProcessInfo } from "../../shared/types";
import { formatPercent, parsePercent } from "~/utils/metrics";
const props = defineProps<{ processes: ProcessInfo[] }>();
// Keyed by pid; the page pauses table updates while anything is selected.
const selection = defineModel<Record<string, boolean>>("selection", { required: true });
const emit = defineEmits<{ kill: [rows: ProcessRow[]] }>();

const UCheckbox = resolveComponent("UCheckbox");

const rows = computed<ProcessRow[]>(() =>
  props.processes
    .filter((p) => p.pid != null)
    .map((p) => ({
      pid: String(p.pid),
      name: p.app,
      cpu: parsePercent(p.cpuPercent),
      memory: parsePercent(p.memoryPercent),
    })),
);
const selected = computed(() => rows.value.filter((row) => selection.value[row.pid]));

const NUMERIC = { th: "text-end", td: "text-end tabular-nums" };

const columns: TableColumn<ProcessRow>[] = [
  {
    id: "select",
    header: ({ table }) =>
      h(UCheckbox, {
        modelValue: table.getIsSomePageRowsSelected() ? "indeterminate" : table.getIsAllPageRowsSelected(),
        "onUpdate:modelValue": (value: boolean | "indeterminate") => table.toggleAllPageRowsSelected(!!value),
        "aria-label": "Select all processes",
      }),
    cell: ({ row }) =>
      h(UCheckbox, {
        modelValue: row.getIsSelected(),
        "onUpdate:modelValue": (value: boolean | "indeterminate") => row.toggleSelected(!!value),
        "aria-label": `Select ${row.original.name} (${row.original.pid})`,
      }),
    meta: { class: { th: "w-10", td: "w-10" } },
  },
  {
    accessorKey: "name",
    header: "Process",
    // Below sm the PID column is hidden and shown under the name instead.
    cell: ({ row }) =>
      h("div", { class: "flex flex-col" }, [
        h("span", { class: "font-mono text-highlighted" }, row.original.name),
        h("span", { class: "font-mono text-xs text-muted sm:hidden" }, `PID ${row.original.pid}`),
      ]),
  },
  {
    accessorKey: "pid",
    header: "PID",
    meta: {
      class: {
        th: "hidden text-end sm:table-cell",
        td: "hidden text-end font-mono text-muted tabular-nums sm:table-cell",
      },
    },
  },
  { accessorKey: "cpu", header: "CPU", cell: ({ row }) => formatPercent(row.original.cpu, 1), meta: { class: NUMERIC } },
  { accessorKey: "memory", header: "Memory", cell: ({ row }) => formatPercent(row.original.memory, 1), meta: { class: NUMERIC } },
];
</script>

<template>
  <AppPanel flush>
    <template #header>
      <h2 class="text-sm font-semibold text-highlighted">
        Processes <span class="font-normal text-muted tabular-nums">{{ rows.length }}</span>
      </h2>
    </template>
    <template #actions>
      <div class="flex items-center gap-3">
        <span v-if="selected.length" class="text-xs text-muted">{{ selected.length }} selected · updates paused</span>
        <UButton
          color="error"
          variant="soft"
          size="sm"
          icon="i-lucide-octagon-x"
          label="Kill"
          :disabled="!selected.length"
          @click="emit('kill', selected)"
        />
      </div>
    </template>
    <UTable
      v-model:row-selection="selection"
      :data="rows"
      :columns="columns"
      :get-row-id="(row: ProcessRow) => row.pid"
      empty="No processes reported"
      :ui="{
        th: 'px-2.5 py-2.5 text-xs font-medium text-muted sm:px-4',
        td: 'px-2.5 py-2.5 sm:px-4',
        thead: 'bg-muted/60',
      }"
    />
  </AppPanel>
</template>
