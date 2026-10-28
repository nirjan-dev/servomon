<script setup lang="ts">
defineProps<{ collapsed?: boolean }>();
const open = ref(false);
const supported = ref(false);
const permission = ref<NotificationPermission>("default");
const subscription = shallowRef<PushSubscription | null>(null);
const busy = ref(false);
const error = ref("");
const enabled = computed(() => !!subscription.value);

async function syncSubscription(registration: ServiceWorkerRegistration) {
  subscription.value = await registration.pushManager.getSubscription();
  if (!subscription.value) return;
  const check = await $fetch("/api/check-subscription", { params: { endpoint: subscription.value.endpoint } });
  if (!check.isSubscribed) await $fetch("/api/subscriptions", { method: "POST", body: subscription.value.toJSON() });
}

onMounted(async () => {
  supported.value = window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!supported.value) return;
  permission.value = Notification.permission;
  try {
    // Waiting for registration never requests permission or creates a subscription.
    await syncSubscription(await navigator.serviceWorker.ready);
  } catch {
    error.value = "Could not sync notifications. Try again.";
  }
});

async function enable() {
  busy.value = true;
  error.value = "";
  try {
    // Request directly from this user gesture, before any network await.
    permission.value = await Notification.requestPermission();
    if (permission.value !== "granted") return;
    const { publicKey } = await $fetch("/api/push/public-key");
    const registration = await navigator.serviceWorker.ready;
    const sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });
    await $fetch("/api/subscriptions", { method: "POST", body: sub.toJSON() });
    subscription.value = sub;
  } catch {
    error.value = "Could not enable notifications. Check the server configuration and try again.";
  } finally {
    busy.value = false;
  }
}

async function disable() {
  if (!subscription.value) return;
  busy.value = true;
  error.value = "";
  try {
    const sub = subscription.value;
    await $fetch("/api/subscriptions", { method: "DELETE", body: { endpoint: sub.endpoint } });
    await sub.unsubscribe();
    subscription.value = null;
  } catch {
    error.value = "Could not disable notifications. Try again.";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Notifications" description="Receive alerts from your systems on this browser.">
    <UButton color="neutral" variant="ghost" icon="i-lucide-bell" :label="collapsed ? undefined : 'Notifications'" aria-label="Notification settings" :square="collapsed" />
    <template #body>
      <div class="space-y-4">
        <p v-if="!supported" class="text-sm text-muted">Push notifications are not supported in this browser or context. HTTPS is required (localhost also works). On iOS, install Servomon to your home screen and open it there first.</p>
        <p v-else-if="permission === 'denied'" class="text-sm text-muted">Notifications are blocked. Re-enable notifications in your browser's site settings, then reload this page.</p>
        <template v-else>
          <p class="text-sm text-muted">{{ enabled ? 'Notifications are enabled on this browser.' : 'Notifications are not enabled on this browser. You can turn them off at any time.' }}</p>
          <UButton v-if="enabled" color="neutral" variant="outline" label="Disable notifications" :loading="busy" @click="disable" />
          <UButton v-else label="Enable notifications" icon="i-lucide-bell" :loading="busy" @click="enable" />
        </template>
        <UAlert v-if="error" color="error" :description="error" />
      </div>
    </template>
  </UModal>
</template>
