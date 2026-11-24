<script lang="ts">
export type ContainerRow = {
  name: string;
  state: string;
  cpu: number | null;
  memory: string;
  memoryBytes: number | null;
  memoryPercent: number | null;
};
export type DockerAction = "stop" | "pause" | "unpause";
</script>

<script setup lang="ts">
import { h, resolveComponent } from "vue";
import type { TableColumn } from "@nuxt/ui";
import type { ContainerInfo } from "../../shared/types";
import { compareMetric, displayMiB, formatPercent, parsePercent, parseQuantity } from "~/utils/metrics";
const props = defineProps<{ containers: ContainerInfo[] }>();
// Keyed by container name; the page pauses table updates while anything is selected.
const selection = defineModel<Record<string, boolean>>("selection", { required: true });
const emit = defineEmits<{ command: [action: DockerAction, rows: ContainerRow[]] }>();

const UCheckbox = resolveComponent("UCheckbox");
const UBadge = resolveComponent("UBadge");
const UButton = resolveComponent("UButton");

const STATE_COLOR: Record<string, "success" | "warning" | "info" | "neutral"> = {
  running: "success",
  paused: "warning",
  restarting: "info",
};

// One numeric column at a time; CPU descending matches the agent's own order.
// Rows are sorted here (missing values last), so UTable sorts manually and
// only tracks the state for header icons and aria-sort.
type SortId = "cpu" | "memoryBytes";
const sorting = ref([{ id: "cpu", desc: true }]);

const rows = computed<ContainerRow[]>(() => {
  const { desc } = sorting.value[0] ?? { desc: true };
  const id = (sorting.value[0]?.id ?? "cpu") as SortId;
  return props.containers
    .map((c) => ({
      name: c.name,
      state: c.state,
      cpu: parsePercent(c.cpuUsed),
      memory: displayMiB(c.memoryUsed),
      memoryBytes: parseQuantity(c.memoryUsed),
      memoryPercent: parsePercent(c.memoryUsedPercent),
    }))
    .sort((a, b) => compareMetric(a[id], b[id], desc));
});
const selected = computed(() => rows.value.filter((row) => selection.value[row.name]));

const NUMERIC = { th: "text-end", td: "text-end tabular-nums" };

function stateBadge(state: string, extraClass = "") {
  return h(UBadge, {
    label: state,
    color: STATE_COLOR[state] ?? "neutral",
    variant: "subtle",
    size: "md",
    class: `capitalize ${extraClass}`,
  });
}

// Header button for a numeric column: first click sorts descending, then flips.
function sortHeader(label: string, column: { getIsSorted(): false | "asc" | "desc"; toggleSorting(desc?: boolean): void }) {
  const sorted = column.getIsSorted();
  return h(UButton, {
    label,
    color: "neutral",
    variant: "ghost",
    size: "xs",
    trailingIcon:
      sorted === "asc"
        ? "i-lucide-arrow-up-narrow-wide"
        : sorted === "desc"
          ? "i-lucide-arrow-down-wide-narrow"
          : "i-lucide-arrow-up-down",
    class: ["-mx-2 -my-1 text-xs font-medium", sorted ? "text-highlighted" : "text-muted"],
    onClick: () => column.toggleSorting(sorted !== "desc"),
  });
}

const columns: TableColumn<ContainerRow>[] = [
  {
    id: "select",
    header: ({ table }) =>
      h(UCheckbox, {
        modelValue: table.getIsSomePageRowsSelected() ? "indeterminate" : table.getIsAllPageRowsSelected(),
        "onUpdate:modelValue": (value: boolean | "indeterminate") => table.toggleAllPageRowsSelected(!!value),
        "aria-label": "Select all containers",
      }),
    cell: ({ row }) =>
      h(UCheckbox, {
        modelValue: row.getIsSelected(),
        "onUpdate:modelValue": (value: boolean | "indeterminate") => row.toggleSelected(!!value),
        "aria-label": `Select ${row.original.name}`,
      }),
    meta: { class: { th: "w-10", td: "w-10" } },
  },
  {
    accessorKey: "name",
    header: "Container",
    // Below sm the State column is hidden and its badge sits under the name.
    cell: ({ row }) =>
      h("div", { class: "flex flex-col items-start gap-1" }, [
        h("span", { class: "font-mono text-highlighted" }, row.original.name),
        stateBadge(row.original.state, "sm:hidden"),
      ]),
  },
  {
    accessorKey: "state",
    header: "State",
    cell: ({ row }) => stateBadge(row.original.state),
    meta: { class: { th: "hidden sm:table-cell", td: "hidden sm:table-cell" } },
  },
  {
    accessorKey: "cpu",
    header: ({ column }) => sortHeader("CPU", column),
    cell: ({ row }) => formatPercent(row.original.cpu, 1),
    enableSorting: true,
    meta: { class: NUMERIC },
  },
  {
    accessorKey: "memoryBytes",
    header: ({ column }) => sortHeader("Memory", column),
    cell: ({ row }) => row.original.memory,
    enableSorting: true,
    meta: { class: NUMERIC },
  },
  {
    accessorKey: "memoryPercent",
    header: "Mem %",
    cell: ({ row }) => formatPercent(row.original.memoryPercent, 1),
    meta: {
      class: { th: "hidden text-end sm:table-cell", td: "hidden text-end tabular-nums sm:table-cell" },
    },
  },
];
</script>

<template>
  <AppPanel flush>
    <template #header>
      <h2 class="text-sm font-semibold text-highlighted">
        Containers <span class="font-normal text-muted tabular-nums">{{ rows.length }}</span>
      </h2>
    </template>
    <template #actions>
      <div class="flex flex-wrap items-center gap-2">
        <span v-if="selected.length" class="text-xs text-muted">{{ selected.length }} selected · updates paused</span>
        <UButton
          color="neutral"
          variant="outline"
          size="sm"
          icon="i-lucide-pause"
          label="Pause"
          :disabled="!selected.length"
          @click="emit('command', 'pause', selected)"
        />
        <UButton
          color="neutral"
          variant="outline"
          size="sm"
          icon="i-lucide-play"
          label="Unpause"
          :disabled="!selected.length"
          @click="emit('command', 'unpause', selected)"
        />
        <UButton
          color="error"
          variant="soft"
          size="sm"
          icon="i-lucide-square"
          label="Stop"
          :disabled="!selected.length"
          @click="emit('command', 'stop', selected)"
        />
      </div>
    </template>
    <UTable
      v-model:row-selection="selection"
      v-model:sorting="sorting"
      :sorting-options="{ manualSorting: true }"
      :data="rows"
      :columns="columns"
      :get-row-id="(row: ContainerRow) => row.name"
      empty="No containers reported"
      :ui="{
        th: 'px-2.5 py-2.5 text-xs font-medium text-muted sm:px-4',
        td: 'px-2.5 py-2.5 sm:px-4',
        thead: 'bg-muted/60',
      }"
    />
  </AppPanel>
</template>
