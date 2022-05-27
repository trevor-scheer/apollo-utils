import type { KeyValueCache } from "@apollo/utils.keyvaluecache";
import Keyv from "keyv";
import { expectType } from "ts-expect";
import { KeyvAdapter } from "..";

describe("KeyvAdapter", () => {
  it("implements KeyValueCache", () => {
    expectType<KeyValueCache<string>>(new KeyvAdapter<string>());
  });

  it("defaults to `string` type", () => {
    // TS will actually over-infer the type of KeyvAdapter without this
    // intermediate variable (demonstrated more clearly in the next test).
    const keyvAdapter = new KeyvAdapter();
    expectType<KeyValueCache<string>>(keyvAdapter);
  });

  it("defaults to `string` type, incompatible with `number` type", () => {
    const keyvAdapter = new KeyvAdapter();
    // @ts-expect-error
    expectType<KeyValueCache<number>>(keyvAdapter);
  });

  it("infers type from keyv argument", () => {
    const numberKeyv = new Keyv<number>();
    expectType<KeyValueCache<number>>(new KeyvAdapter(numberKeyv));
  });

  describe("Keyv methods", () => {
    let keyv: Keyv<number>;
    let keyvAdapter: KeyvAdapter<number>;

    beforeEach(async () => {
      keyv = new Keyv<number>();
      keyvAdapter = new KeyvAdapter(keyv);

      // start with a populated cache for testing the methods
      await keyvAdapter.set("foo", 1);
    });

    it("set", async () => {
      const setSpy = jest.spyOn(keyv, "set");
      await keyvAdapter.set("bar", 1);
      expect(setSpy).toHaveBeenCalledWith("bar", 1);
    });

    it("set with ttl (in SECONDS)", async () => {
      const setSpy = jest.spyOn(keyv, "set");
      await keyvAdapter.set("bar", 1, { ttl: 1 });
      expect(setSpy).toHaveBeenCalledWith("bar", 1, 1000);
    });

    it("correctly awaits `set` call", async () => {
      let storeSetCalled = false;
      const store = {
        set: async () => {
          await new Promise<void>((resolve) => setImmediate(() => resolve()));
          storeSetCalled = true;
        },
        get: async () => 1,
        delete: async () => true,
        clear: async () => {},
        has: () => true,
      };

      keyv = new Keyv({ store });
      keyvAdapter = new KeyvAdapter(keyv);

      await keyvAdapter.set("bar", 1);
      expect(storeSetCalled).toBe(true);
    });

    it("get", async () => {
      const getSpy = jest.spyOn(keyv, "get");
      const result = await keyvAdapter.get("foo");
      expect(result).toBe(1);
      expect(getSpy).toHaveBeenCalledWith("foo");
    });

    it("delete", async () => {
      const deleteSpy = jest.spyOn(keyv, "delete");
      const result = await keyvAdapter.delete("foo");
      expect(result).toBeTruthy();
      expect(deleteSpy).toHaveBeenCalledWith("foo");
    });
  });
});