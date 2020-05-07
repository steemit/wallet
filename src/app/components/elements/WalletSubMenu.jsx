import React from 'react';
import { Link } from 'react-router';
import tt from 'counterpart';

export default ({ accountname, isMyAccount }) => {
    return (
        <ul className="WalletSubMenu menu">
            <li>
                <Link
                    to={`/@${accountname}/transfers`}
                    activeClassName="active"
                >
                    {tt('g.balances')}
                </Link>
            </li>
            <li>
                <Link
                    to={`/@${accountname}/delegations`}
                    activeClassName="active"
                >
                    {tt('g.delegations')}
                </Link>
            </li>
            {isMyAccount ? (
                <li>
                    <Link
                        to={`/@${accountname}/permissions`}
                        activeClassName="active"
                    >
                        {tt('g.permissions')}
                    </Link>
                </li>
            ) : null}
            {isMyAccount ? (
                <li>
                    <Link
                        to={`/@${accountname}/password`}
                        activeClassName="active"
                    >
                        {tt('g.change_password')}
                    </Link>
                </li>
            ) : null}
            {isMyAccount ? (
                <li>
                    <Link
                        to={`/@${accountname}/communities`}
                        activeClassName="active"
                    >
                        {tt('g.communities')}
                    </Link>
                </li>
            ) : null}
        </ul>
    );
};
