namespace WebApplication2.DTOs
{
    /// <summary>
    /// Request body for POST api/independent-monitoring/pairing-codes.
    ///
    /// SECURITY: the child id is only a TARGET. It is never treated as proof of
    /// authority - the server resolves the caller from the bearer token and
    /// re-checks that the caller is an authorized ChildGuardian of that child
    /// (ChildGuardian is the only monitoring authority; the legacy
    /// Child.Parent_ID column is deliberately not trusted). A caller that is not
    /// a guardian gets the same 404 a non-existent child would get, so the
    /// endpoint cannot be used to probe which children exist.
    ///
    /// There is deliberately no field for an actor, a role, a device name or a
    /// session id: everything else is server-derived.
    /// </summary>
    public class IndependentPairingCodeRequest
    {
        /// <summary>Child the parent wants to monitor. Must be a positive int.</summary>
        public int ChildId { get; set; }
    }

    /// <summary>
    /// Request body for POST api/independent-monitoring/device/pair.
    ///
    /// This is the ONLY thing a monitoring device (Phone 2) is allowed to send
    /// before it is paired. It cannot name a child, a parent or a session:
    /// the server derives all three from the redeemed code, so a device can
    /// never request access to somebody else's child.
    /// </summary>
    public class IndependentPairingRedeemRequest
    {
        /// <summary>
        /// The code shown on the parent phone. Normalised server-side
        /// (spaces and dashes removed, upper-cased) before hashing, so
        /// "abcd-efgh ij" and "ABCDEFGHIJ" are the same code.
        /// </summary>
        public string Code { get; set; }

        /// <summary>
        /// Optional human label for the device ("Nursery Samsung"). Display
        /// only; it never affects authorization.
        /// </summary>
        public string DeviceName { get; set; }
    }
}
