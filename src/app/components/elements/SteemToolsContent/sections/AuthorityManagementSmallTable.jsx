import React from 'react';
import { Link } from 'react-router';
import tt from 'counterpart';

const AuthorityManagementSmallTable = ({
    rows,
    loading,
    canEdit,
    onRemoveSingleAuthority,
}) => {
    if (!rows.length) {
        return (
            <div className="change-recovery-account-hint">
                {tt('steem_tools.authority_management.no_account_authorities')}
            </div>
        );
    }

    return (
        <table>
            <thead>
                <tr>
                    <th style={{ minWidth: '100%' }}>
                        <span
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                float: 'left',
                                marginLeft: 0,
                                minWidth: '100%',
                                gap: '0.5rem',
                            }}
                        >
                            <span>
                                {`${tt(
                                    'steem_tools.authority_management.current_account_authorities'
                                )} (${rows.length})`}
                            </span>
                        </span>
                    </th>
                </tr>
            </thead>
            <tbody>
                {rows.map(({ type, name, weight }) => (
                    <tr key={`${type}-${name}`}>
                        <td
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '0.5rem',
                            }}
                        >
                            <span>
                                <span style={{ fontWeight: 'bold' }}>
                                    {`${tt('steem_tools.authority_management.authority_type')}: `}
                                </span>
                                {tt(
                                    `steem_tools.authority_management.authority_${type}`
                                )}
                            </span>

                            <span>
                                <span style={{ fontWeight: 'bold' }}>
                                    {`${tt(
                                        'steem_tools.authority_management.authorized_account_header'
                                    )}: `}
                                </span>
                                <Link to={`/@${name}`}>@{name}</Link>
                            </span>

                            <span>
                                <span style={{ fontWeight: 'bold' }}>
                                    {`${tt(
                                        'steem_tools.authority_management.weight_header'
                                    )}: `}
                                </span>
                                {weight}
                            </span>

                            <button
                                type="button"
                                className="button alert hollow tiny"
                                style={{
                                    margin: 0,
                                    padding: '0.2rem 0.6rem',
                                    alignSelf: 'flex-start',
                                }}
                                onClick={() =>
                                    onRemoveSingleAuthority(type, name)
                                }
                                disabled={loading || !canEdit}
                            >
                                x
                            </button>
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
};

export default AuthorityManagementSmallTable;
