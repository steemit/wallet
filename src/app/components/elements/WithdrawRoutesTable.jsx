import React from 'react';
import tt from 'counterpart';

class WithdrawRoutesTable extends React.Component {
    render() {
        const { routes, accountName, steemPower } = this.props;

        const totalPercent = routes.reduce((acc, r) => acc + r.percent, 0);
        const remainingPercent = 10000 - totalPercent;

        return (
            <div style={{ overflowX: "auto", marginBottom: "1rem" }}>
                <table className="withdraw-routes-table">
                    <thead>
                        <tr>
                            <th>{tt('advanced_routes.account')}</th>
                            <th>{tt('advanced_routes.percent')}</th>
                            {steemPower && <th>{tt('advanced_routes.receive_amount')}</th>}
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>
                                <a
                                    href={`/@${accountName}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ color: '#1FBF8F' }}
                                >
                                    {accountName}
                                </a>
                            </td>
                            <td>{remainingPercent / 100}%</td>
                            {steemPower && <td>{`${(remainingPercent / 10000 * parseFloat(steemPower)).toFixed(3)} ${tt('advanced_routes.steem')}`}</td>}
                        </tr>
                        {routes.map((route) => (
                            <tr key={route.to_account}>
                                <td>
                                    <a
                                        href={`/@${route.to_account}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        style={{ color: '#1FBF8F' }}
                                    >
                                        {route.to_account}
                                    </a>
                                </td>
                                <td>{route.percent / 100}%</td>
                                {steemPower && (
                                    <td>
                                        {`${(route.percent / 10000 * parseFloat(steemPower)).toFixed(3)} ${route.auto_vest ? 'SP' : tt('advanced_routes.steem')}`}
                                    </td>
                                )}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    }
}

export default WithdrawRoutesTable;
