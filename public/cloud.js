/* global supabase */
"use strict";

// All database access is authenticated; the database enforces account ownership.
class TasklineCloud {
  constructor(client) {
    this.client = client;
    this.user = null;
    this.revision = 0;
    this.channel = null;
  }

  async session() {
    const { data, error } = await this.client.auth.getUser();
    if (error && error.name !== "AuthSessionMissingError") throw error;
    this.user = data?.user || null;
    return this.user;
  }

  async signIn(email) {
    const { error } = await this.client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: location.origin + location.pathname },
    });
    if (error) throw error;
  }

  async signOut() {
    const { error } = await this.client.auth.signOut({ scope: "local" });
    if (error) throw error;
    this.user = null;
    this.revision = 0;
    await this.unsubscribe();
  }

  async load() {
    if (!this.user) throw Error("Sign in to load your synced tasks.");
    const { data, error } = await this.client
      .from("taskline_boards")
      .select("tasks,revision")
      .eq("owner_id", this.user.id)
      .maybeSingle();
    if (error) throw error;
    return data || { tasks: [], revision: 0 };
  }

  async save(tasks) {
    if (!this.user) throw Error("Sign in before saving.");
    const { data, error } = await this.client.rpc("save_taskline_board", {
      expected_revision: this.revision,
      new_tasks: tasks,
    });
    if (error) {
      if (error.code === "40001") {
        throw Error(
          "Tasks changed on another computer. Your draft is kept. Export it, then close the form and refresh before applying your changes.",
        );
      }
      throw error;
    }
    this.revision = data;
    return data;
  }

  async subscribe(onChange) {
    await this.unsubscribe();
    if (!this.user) return;
    this.channel = this.client
      .channel("taskline-" + this.user.id)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "taskline_boards",
          filter: "owner_id=eq." + this.user.id,
        },
        onChange,
      )
      .subscribe();
  }

  async unsubscribe() {
    if (this.channel) await this.client.removeChannel(this.channel);
    this.channel = null;
  }
}

globalThis.TasklineCloud = TasklineCloud;
