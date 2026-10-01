"use strict";

// A 256-bit private link grants access to one board. No sign-in session is used.
class TasklineCloud {
  constructor(client, token) {
    this.client = client;
    this.token = /^[a-f0-9]{64}$/.test(token || "") ? token : null;
    this.revision = 0;
  }

  async load() {
    if (!this.token)
      throw Error("Open your private sync link to load your tasks.");
    const { data, error } = await this.client.rpc("load_taskline_link", {
      link_token: this.token,
    });
    if (error) throw error;
    if (!data) throw Error("This private link is invalid or has been revoked.");
    return data;
  }

  async save(tasks) {
    if (!this.token) throw Error("Open your private sync link before saving.");
    const { data, error } = await this.client.rpc("save_taskline_link", {
      link_token: this.token,
      expected_revision: this.revision,
      new_tasks: tasks,
    });
    if (error) {
      if (error.code === "40001")
        throw Error(
          "Tasks changed on another computer. Your draft is kept. Export it, then close the form and refresh before applying your changes.",
        );
      throw error;
    }
    this.revision = data;
    return data;
  }
}
globalThis.TasklineCloud = TasklineCloud;
