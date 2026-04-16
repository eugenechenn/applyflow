function createD1Adapter(binding) {
  return {
    kind: "d1",
    bindingName: process.env.CLOUDFLARE_D1_BINDING || "APPLYFLOW_DB",
    binding,
    async get() {
      throw new Error("D1 adapter is not active in the Node runtime yet.");
    },
    async all() {
      throw new Error("D1 adapter is not active in the Node runtime yet.");
    },
    async run() {
      throw new Error("D1 adapter is not active in the Node runtime yet.");
    },
    async exec() {
      throw new Error("D1 adapter is not active in the Node runtime yet.");
    },
    async transaction() {
      throw new Error("D1 adapter transactions will be wired when the Cloudflare Worker runtime is enabled.");
    }
  };
}

module.exports = {
  createD1Adapter
};
