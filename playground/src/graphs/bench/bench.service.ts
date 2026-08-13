import { Service } from "@warbler/core";

@Service()
export class BenchService {
  value() {
    return "OK";
  }
  getById(id: string) {
    return {
      id,
      name: "Habib",
    };
  }
}