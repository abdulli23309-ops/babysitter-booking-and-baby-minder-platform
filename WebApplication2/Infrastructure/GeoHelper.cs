// ---------------------------------------------------------------------------
// GeoHelper.cs
// Pure-C# haversine distance calculation. No external dependencies.
// Used by MatchingService for radius-aware sitter filtering.
// ---------------------------------------------------------------------------
using System;

namespace WebApplication2.Infrastructure
{
    public static class GeoHelper
    {
        private const double EarthRadiusKm = 6371.0;

        /// <summary>
        /// Returns the great-circle (haversine) distance in kilometers
        /// between two WGS-84 coordinates.
        /// </summary>
        public static double HaversineDistanceKm(double lat1, double lon1, double lat2, double lon2)
        {
            double dLat = ToRadians(lat2 - lat1);
            double dLon = ToRadians(lon2 - lon1);

            double a =
                Math.Sin(dLat / 2) * Math.Sin(dLat / 2) +
                Math.Cos(ToRadians(lat1)) * Math.Cos(ToRadians(lat2)) *
                Math.Sin(dLon / 2) * Math.Sin(dLon / 2);

            double c = 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
            return EarthRadiusKm * c;
        }

        private static double ToRadians(double degrees)
        {
            return degrees * Math.PI / 180.0;
        }
    }
}