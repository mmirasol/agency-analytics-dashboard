import { NextRequest, NextResponse } from "next/server";
import { format, parse } from "date-fns";
import { BetaAnalyticsDataClient } from "@google-analytics/data";

function getServiceAccountCredentials() {
  // Preferred: full JSON payload from Google Cloud service account key file.
  if (process.env.GOOGLE_ANALYTICS_SERVICE_ACCOUNT_JSON) {
    try {
      const parsed = JSON.parse(process.env.GOOGLE_ANALYTICS_SERVICE_ACCOUNT_JSON);
      if (!parsed.private_key || !parsed.client_email || !parsed.client_id) {
        throw new Error("JSON is missing private_key, client_email, or client_id");
      }

      return {
        ...parsed,
        private_key: String(parsed.private_key).replace(/\\n/g, "\n"),
      };
    } catch (error) {
      throw new Error("Invalid GOOGLE_ANALYTICS_SERVICE_ACCOUNT_JSON value");
    }
  }

  // Backward-compatible env var set.
  const requiredVars = [
    "GOOGLE_SERVICE_ACCOUNT_CREDENTIALS_PROJECT_ID",
    "GOOGLE_SERVICE_ACCOUNT_CREDENTIALS_PRIVATE_KEY_ID",
    "GOOGLE_SERVICE_ACCOUNT_CREDENTIALS_PRIVATE_KEY",
    "GOOGLE_SERVICE_ACCOUNT_CREDENTIALS_CLIENT_EMAIL",
    "GOOGLE_SERVICE_ACCOUNT_CREDENTIALS_CLIENT_ID",
  ] as const;

  const missing = requiredVars.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing GA credentials: ${missing.join(", ")}`);
  }

  return {
    type: "service_account",
    project_id: process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS_PROJECT_ID,
    private_key_id: process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS_PRIVATE_KEY_ID,
    private_key: process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS_PRIVATE_KEY!.replace(
      /\\n/g,
      "\n",
    ),
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS_CLIENT_EMAIL,
    client_id: process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS_CLIENT_ID,
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
    auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
    universe_domain: "googleapis.com",
  };
}

export async function POST(request: NextRequest) {
  try {
    const { propertyId, startDate, endDate } = await request.json();
    if (!propertyId || !startDate || !endDate) {
      return NextResponse.json(
        { error: "propertyId, startDate, and endDate are required" },
        { status: 400 },
      );
    }

    let credentials;
    try {
      credentials = getServiceAccountCredentials();
    } catch (error) {
      console.error("GA credentials configuration error:", error);
      return NextResponse.json(
        {
          error:
            "Server configuration error: missing/invalid GA service account credentials",
        },
        { status: 500 },
      );
    }

    // Create the GA Data API client with credentials
    const client = new BetaAnalyticsDataClient({ credentials });

    // Build the report request.
    const requestBody = {
      property: `properties/${propertyId}`,
      dateRanges: [
        {
          startDate,
          endDate,
        },
      ],
      dimensions: [{ name: "date" }],
      metrics: [
        { name: "sessions" },
        { name: "totalUsers" },
        { name: "bounceRate" },
        { name: "averageSessionDuration" },
        { name: "purchaseRevenue" },
        { name: "transactions" },
      ],
    };

    const [response] = await client.runReport(requestBody);

    const rows =
      response.rows?.map((row) => {
        // Parse date (YYYYMMDD) and format as "MMM dd, yyyy"
        const dateFormatted =
          row.dimensionValues && row.dimensionValues[0]?.value
            ? format(
                parse(
                  row.dimensionValues[0].value as string,
                  "yyyyMMdd",
                  new Date(),
                ),
                "MMM dd, yyyy",
              )
            : "Invalid Date";
        return {
          date: dateFormatted,
          sessions: row.metricValues?.[0]?.value ?? "0",
          totalUsers: row.metricValues?.[1]?.value ?? "0",
          bounceRate: row.metricValues?.[2]?.value ?? "0",
          avgSessionDuration: row.metricValues?.[3]?.value ?? "0",
          purchaseRevenue: row.metricValues?.[4]?.value ?? "0",
          transactions: row.metricValues?.[5]?.value ?? "0",
        };
      }) || [];

    return NextResponse.json({ rows }, { status: 200 });
  } catch (error) {
    console.error("Error in GA analyze:", error);
    return NextResponse.json(
      { error: "An error occurred while analyzing data" },
      { status: 500 },
    );
  }
}
