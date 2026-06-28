import { Request, Response, NextFunction } from 'express';

export class AuthMiddleware {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  verify = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const queryToken = req.query.token as string;

    // Check Authorization header (Bearer token)
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      if (token === this.token) {
        return next();
      }
    }

    // Check query parameter
    if (queryToken === this.token) {
      return next();
    }

    res.status(401).json({ error: 'Unauthorized' });
  };
}
