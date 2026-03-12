// server/middleware/validate.ts
import { AnyZodObject, ZodError } from "zod";
import { Request, Response, NextFunction } from "express";

export function validate(opts: {
  params?: AnyZodObject;
  query?: AnyZodObject;
  body?: AnyZodObject;
}) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      if (opts.params) req.params = opts.params.parse(req.params);
      if (opts.query)  req.query  = opts.query.parse(req.query);
      if (opts.body)   req.body   = opts.body.parse(req.body);
      return next();
    } catch (e) {
      if (e instanceof ZodError) {
        return res.status(400).json({ error: "validation_failed", issues: e.issues });
      }
      return res.status(400).json({ error: (e as any)?.message || "invalid request" });
    }
  };
}