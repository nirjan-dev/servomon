FROM denoland/deno:2.1.7 AS builder

WORKDIR /app

COPY . .

RUN cd agent && deno cache main.ts && deno task build

FROM debian:12 

WORKDIR /app

COPY --from=builder /app/agent/servomon-agent ./servomon-agent

EXPOSE 8000

ENTRYPOINT ["./servomon-agent"]