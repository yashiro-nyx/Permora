import {
  Pool,
  type PoolClient,
  type PoolConfig,
} from "pg";
import { connectWithTransientRetry } from "./database-connection";

export class ResilientPool extends Pool {
  constructor(
    config: PoolConfig,
    private readonly maximumConnectionAttempts: number,
  ) {
    super(config);
  }

  override connect(): Promise<PoolClient>;
  override connect(
    callback: (
      error: Error | undefined,
      client: PoolClient | undefined,
      done: (release?: boolean | Error) => void,
    ) => void,
  ): void;
  override connect(
    callback?: (
      error: Error | undefined,
      client: PoolClient | undefined,
      done: (release?: boolean | Error) => void,
    ) => void,
  ) {
    const connection = connectWithTransientRetry(
      () => super.connect(),
      this.maximumConnectionAttempts,
    );
    if (!callback) return connection;
    void connection.then(
      (client) => callback(undefined, client, client.release.bind(client)),
      (error: unknown) =>
        callback(
          error instanceof Error
            ? error
            : new Error("Database connection failed."),
          undefined,
          () => undefined,
        ),
    );
  }
}
