self.addEventListener("push", (event) => {
  try {
    const data = event.data.text();
    self.registration.showNotification(data);
  } catch (error) {
    console.log("error showing notification", error);
  }
});
