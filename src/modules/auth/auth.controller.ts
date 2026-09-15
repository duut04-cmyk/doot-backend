import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import { authService, type AuthService } from "./auth.service.js";
import type {
  LoginBody,
  LogoutBody,
  ForgotPasswordBody,
  GoogleLoginBody,
  RefreshSessionBody,
  ResendOtpBody,
  ResetPasswordBody,
  SignupBody,
  VerifyOtpBody,
} from "./auth.schema.js";

export class AuthController {
  constructor(private readonly service: AuthService = authService) {}

  signup = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const body = req.body as SignupBody;
      const result = await this.service.signup(body);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  };

  verifyOtp = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const body = req.body as VerifyOtpBody;
      const result = await this.service.verifyOtp(body);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  resendOtp = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const body = req.body as ResendOtpBody;
      const result = await this.service.resendOtp(body);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  login = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const body = req.body as LoginBody;
      const result = await this.service.login(body);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  refresh = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const body = req.body as RefreshSessionBody;
      const result = await this.service.refreshSession(body);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  logout = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const body = req.body as LogoutBody;
      const result = await this.service.logout(body);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  me = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user) {
        next(
          new AppError("Authentication required.", {
            statusCode: 401,
            code: ErrorCodes.UNAUTHORIZED,
          }),
        );
        return;
      }
      const result = await this.service.getCurrentUser(req.user.id);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  forgotPassword = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const body = req.body as ForgotPasswordBody;
      const result = await this.service.forgotPassword(body);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  resetPassword = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const body = req.body as ResetPasswordBody;
      const result = await this.service.resetPassword(body);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  googleLogin = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const body = req.body as GoogleLoginBody;
      const result = await this.service.googleLogin(body);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}

export const authController = new AuthController();
