# Servomon | simple home server monitoring

## Installing the agent binary
- download the binary located at `/agent/dist/servomon-agent` in this repo (alternatively, you can build it yourself, if you have deno installed, just go into the agent folder and run the `deno task build` command)
- make sure the binary you downloaded is executable. You can run `chmod +x path/to/executable` to make it executable.
- In the same folder as the deno binary, you also need to have an .env file with the different options for the agent. You can create one by copying the `/agent/.env.example` file.
- Once you set that up, you can run the agent by just executing it like this: `/path/to/binary/servomon-agent`
- You can keep running it in the background with: 
    - `Ctrl + Z` to suspend it
    - bg to run it in the background
- You can also setup a systemd service unit to run it in the background and restart it automatically
    - you can find an example systemd unit service file at `/agent/servomon_agent.service` (you just need to update it for your paths and username)
    - you will need to save this file at `/etc/systemd/system/`
    - then run the following commands
        - `sudo systemctl daemon-reload` to reload systemctl daemon
        - `sudo systemctl enable servomon_agent` to enable your service (if you renamed it then make sure to use the name that you used)
        - `sudo systemctl start servomon_agent` to start the service
        - `systemctl status servomon_agent` to check the status of your service
    - if the agent CLI is working without any errors then you should see it on the homepage of the web app now.

