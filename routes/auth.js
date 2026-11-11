
const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const db = require("../config/db");

const router = express.Router();

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

router.post("/register", async (req, res) => {

    const { name, student_id, email, password } = req.body;

    if (!name || !student_id || !email || !password) {
        return res.status(400).json({
            success: false,
            message: "All fields are required"
        });
    }

    const cleanEmail = email.trim().toLowerCase();

    // Check university email domain
    if (!cleanEmail.endsWith("@northsouth.edu")) {
        return res.status(400).json({
            success: false,
            message: "Use your university email"
        });
    }

    try {
        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Generate 6 digit OTP
        const otp = crypto.randomInt(100000, 1000000).toString();

        // OTP expires after 5 minutes
        const expiry = new Date(Date.now() + 5 * 60 * 1000);

        const sql = `
            INSERT INTO users
            (name, student_id, email, password, otp, otp_expiry)
            VALUES (?, ?, ?, ?, ?, ?)
        `;

        db.query(
            sql,
            [name, student_id, cleanEmail, hashedPassword, otp, expiry],
            async (err) => {

                if (err) {
                    if (err.code === "ER_DUP_ENTRY") {
                        return res.status(409).json({
                            success: false,
                            message: "Student ID or email already exists"
                        });
                    }

                    return res.status(500).json({
                        success: false,
                        message: "Registration failed"
                    });
                }

                try {
                    await transporter.sendMail({
                        from: process.env.EMAIL_USER,
                        to: cleanEmail,
                        subject: "Lost and Found - Email Verification",
                        text: `Your OTP is ${otp}. It expires in 5 minutes.`
                    });

                    res.json({
                        success: true,
                        message: "OTP sent to your email"
                    });

                } catch (emailError) {
                    db.query(
                        "DELETE FROM users WHERE email = ? AND is_verified = FALSE",
                        [cleanEmail]
                    );

                    res.status(500).json({
                        success: false,
                        message: "Could not send OTP email. Try again."
                    });
                }
            }
        );

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

router.post("/login", (req, res) => {

    const { identifier, password } = req.body;

    if (!identifier || !password) {
        return res.status(400).json({
            success: false,
            message: "Enter your ID/email and password"
        });
    }

    const sql = `
        SELECT * FROM users
        WHERE email = ? OR student_id = ?
    `;

    db.query(sql, [identifier.trim().toLowerCase(), identifier.trim()], async (err, result) => {

        if (err) {
            return res.status(500).json({
                success: false,
                message: "Database error"
            });
        }

        if (result.length === 0) {
            return res.status(401).json({
                success: false,
                message: "Invalid login information"
            });
        }

        const user = result[0];

        if (!user.is_verified) {
            return res.status(403).json({
                success: false,
                message: "Please verify your email first"
            });
        }

        const match = await bcrypt.compare(password, user.password);

        if (!match) {
            return res.status(401).json({
                success: false,
                message: "Invalid login information"
            });
        }

        const token = jwt.sign(
            {
                id: user.id,
                student_id: user.student_id
            },
            process.env.JWT_SECRET,
            { expiresIn: "1d" }
        );

        res.json({
            success: true,
            message: "Login successful",
            token: token,
            user: {
                id: user.id,
                name: user.name,
                student_id: user.student_id,
                email: user.email
            }
        });
    });
});

module.exports = router;
