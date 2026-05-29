import { Request, Response, NextFunction } from 'express';
export interface JwtPayload {
    id: string;
    role: 'admin' | 'blogger';
}
declare global {
    namespace Express {
        interface Request {
            user?: JwtPayload;
        }
    }
}
export declare function authenticateToken(req: Request, res: Response, next: NextFunction): void;
export declare function requireRole(role: 'admin' | 'blogger'): (req: Request, res: Response, next: NextFunction) => void;
export declare function requireApiKey(req: Request, res: Response, next: NextFunction): void;
